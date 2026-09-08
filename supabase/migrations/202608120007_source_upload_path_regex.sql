-- PostgreSQL repetition counts are implementation-bounded. Keep the same
-- strict character set and enforce the path length separately.
create or replace function public.reserve_source_upload(
  p_workspace_id uuid,
  p_case_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint
) returns uuid language plpgsql security definer set search_path = public as $$
declare source_id uuid;
begin
  if not exists (
    select 1
      from public.cases c
      join public.workspace_members m on m.workspace_id = c.workspace_id
     where c.id = p_case_id
       and c.workspace_id = p_workspace_id
       and m.user_id = p_user_id
  ) then
    raise exception 'not authorized';
  end if;
  if p_storage_path not like p_workspace_id::text || '/' || p_case_id::text || '/%'
     or p_storage_path !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$'
     or char_length(p_storage_path) > 360
     or p_storage_path like '%..%' then
    raise exception 'invalid storage path';
  end if;
  if p_byte_size <= 0 or p_byte_size > 10485760 then raise exception 'source size limit exceeded'; end if;
  if p_mime_type not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown') then raise exception 'unsupported source type'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_case_id::text, 0));
  if (
    select count(*)
      from public.source_items
     where case_id = p_case_id
       and source_kind = 'private_upload'
       and extraction_status <> 'failed'
  ) >= 5 then
    raise exception 'source limit reached';
  end if;

  insert into public.source_items(
    workspace_id, case_id, source_kind, storage_path, filename, mime_type,
    byte_size, sha256, extraction_status, created_by
  ) values (
    p_workspace_id, p_case_id, 'private_upload', p_storage_path,
    left(p_filename, 255), p_mime_type, p_byte_size, null, 'pending', p_user_id
  ) returning id into source_id;
  return source_id;
end $$;

revoke all on function public.reserve_source_upload(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.reserve_source_upload(uuid, uuid, uuid, text, text, text, bigint) to service_role;
