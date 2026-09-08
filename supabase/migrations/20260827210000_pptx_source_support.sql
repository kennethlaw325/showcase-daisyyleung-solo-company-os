-- Add modern PowerPoint source support without broadening the legacy binary
-- format surface. PPTX is an OOXML package; .ppt remains unsupported.

alter table public.source_items
  add constraint source_items_mime_type_check_pptx
  check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown'
  )) not valid;

alter table public.source_items
  validate constraint source_items_mime_type_check_pptx;

alter table public.source_items
  drop constraint source_items_mime_type_check;

alter table public.source_items
  rename constraint source_items_mime_type_check_pptx to source_items_mime_type_check;

update storage.buckets
   set public = false,
       file_size_limit = 10485760,
       allowed_mime_types = array[
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'text/plain',
         'text/markdown'
       ]::text[]
 where id = 'source-documents';

create or replace function public.reserve_source_upload(
  p_workspace_id uuid,
  p_case_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id uuid;
  case_row public.cases;
begin
  select c.* into case_row
    from public.cases c
   where c.id = p_case_id
     and c.workspace_id = p_workspace_id
   for update;

  if case_row.id is null
     or case_row.deletion_request_id is not null
     or case_row.status = 'cancelled'
     or not exists (
       select 1
         from public.workspace_members m
        where m.workspace_id = p_workspace_id
          and m.user_id = p_user_id
     ) then
    raise exception 'not authorized';
  end if;

  if p_storage_path not like p_workspace_id::text || '/' || p_case_id::text || '/%'
     or p_storage_path !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$'
     or pg_catalog.char_length(p_storage_path) > 360
     or p_storage_path like '%..%' then
    raise exception 'invalid storage path';
  end if;

  if p_filename is null or pg_catalog.char_length(pg_catalog.btrim(p_filename)) not between 1 and 255 then
    raise exception 'invalid source filename';
  end if;

  if p_byte_size <= 0 or p_byte_size > 10485760 then
    raise exception 'source size limit exceeded';
  end if;

  if p_mime_type not in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown'
  ) then
    raise exception 'unsupported source type';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_case_id::text, 0));
  if (
    select pg_catalog.count(*)
      from public.source_items s
     where s.case_id = p_case_id
       and s.source_kind = 'private_upload'
       and s.extraction_status <> 'failed'
  ) >= 5 then
    raise exception 'source limit reached';
  end if;

  insert into public.source_items(
    workspace_id,
    case_id,
    source_kind,
    storage_path,
    filename,
    mime_type,
    byte_size,
    sha256,
    extraction_status,
    created_by
  ) values (
    p_workspace_id,
    p_case_id,
    'private_upload',
    p_storage_path,
    pg_catalog.left(pg_catalog.btrim(p_filename), 255),
    p_mime_type,
    p_byte_size,
    null,
    'pending',
    p_user_id
  ) returning id into source_id;

  return source_id;
end
$$;

create or replace function public.finalize_source_extraction(
  p_workspace_id uuid,
  p_case_id uuid,
  p_source_id uuid,
  p_user_id uuid,
  p_status text,
  p_sha256 text default null,
  p_extracted_text text default null,
  p_error_code text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.cases;
  source_row public.source_items;
begin
  if p_workspace_id is null
     or p_case_id is null
     or p_source_id is null
     or p_user_id is null
     or p_status not in ('extracted', 'failed') then
    return false;
  end if;

  select c.* into case_row
    from public.cases c
   where c.id = p_case_id
     and c.workspace_id = p_workspace_id
   for update;

  if case_row.id is null
     or case_row.deletion_request_id is not null
     or case_row.status = 'cancelled' then
    return false;
  end if;

  select s.* into source_row
    from public.source_items s
   where s.id = p_source_id
     and s.workspace_id = p_workspace_id
     and s.case_id = p_case_id
     and s.created_by = p_user_id
     and s.source_kind = 'private_upload'
   for update;

  if source_row.id is null then
    return false;
  end if;

  if p_status = 'extracted' then
    if p_sha256 is null
       or p_sha256 !~ '^[a-f0-9]{64}$'
       or p_extracted_text is null
       or pg_catalog.char_length(pg_catalog.btrim(p_extracted_text)) not between 1 and 100000
       or p_error_code is not null then
      return false;
    end if;
  elsif p_sha256 is not null
        or p_extracted_text is not null
        or p_error_code is null
        or p_error_code !~ '^[a-z0-9][a-z0-9_]{0,119}$' then
    return false;
  end if;

  if source_row.extraction_status <> 'pending' then
    return source_row.extraction_status = p_status
       and source_row.sha256 is not distinct from p_sha256
       and source_row.extracted_text is not distinct from p_extracted_text
       and source_row.extraction_error_code is not distinct from p_error_code;
  end if;

  update public.source_items s
     set extraction_status = p_status,
         sha256 = p_sha256,
         extracted_text = p_extracted_text,
         extraction_error_code = p_error_code
   where s.id = source_row.id
     and s.workspace_id = p_workspace_id
     and s.case_id = p_case_id
     and s.extraction_status = 'pending';

  if not found then
    return false;
  end if;

  insert into public.audit_events(
    workspace_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    p_user_id,
    case when p_status = 'extracted' then 'source.extraction_completed' else 'source.extraction_failed' end,
    'source_item',
    source_row.id,
    case
      when p_status = 'extracted' then pg_catalog.jsonb_build_object('status', p_status)
      else pg_catalog.jsonb_build_object('status', p_status, 'error_code', p_error_code)
    end
  );

  return true;
end
$$;

revoke all on function public.reserve_source_upload(uuid, uuid, uuid, text, text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_source_upload(uuid, uuid, uuid, text, text, text, bigint)
  to service_role;

revoke all on function public.finalize_source_extraction(uuid, uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_source_extraction(uuid, uuid, uuid, uuid, text, text, text, text)
  to service_role;
