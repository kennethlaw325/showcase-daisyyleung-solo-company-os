-- Per-case deletion is a two-phase, service-role-only operation.  The first
-- phase locks and tombstones the case; the API then removes Storage objects
-- and calls the finalizer with the same request UUID.

alter table public.cases
  add column if not exists deletion_request_id uuid,
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_requested_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cases_deletion_fields_consistent'
       and conrelid = 'public.cases'::regclass
  ) then
    alter table public.cases add constraint cases_deletion_fields_consistent check (
      (deletion_request_id is null and deletion_requested_at is null and deletion_requested_by is null)
      or (deletion_request_id is not null and deletion_requested_at is not null and deletion_requested_by is not null)
    );
  end if;
end $$;

create index if not exists cases_deletion_request_idx
  on public.cases(workspace_id, deletion_request_id)
  where deletion_request_id is not null;

-- A case-derived learning record is deleted with its source case.  Any
-- cross-case application that points at that record/outcome/source case is
-- deleted by the corresponding cascade, while other cases remain intact.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'learning_records_case_id_fkey' and conrelid = 'public.learning_records'::regclass) then
    alter table public.learning_records drop constraint learning_records_case_id_fkey;
  end if;
  alter table public.learning_records
    add constraint learning_records_case_id_fkey
    foreign key (case_id) references public.cases(id) on delete cascade;

  if exists (select 1 from pg_constraint where conname = 'applications_workspace_learning_fk' and conrelid = 'public.case_learning_applications'::regclass) then
    alter table public.case_learning_applications drop constraint applications_workspace_learning_fk;
  end if;
  alter table public.case_learning_applications
    add constraint applications_workspace_learning_fk
    foreign key (workspace_id, learning_id) references public.learning_records(workspace_id, id) on delete cascade;

  if exists (select 1 from pg_constraint where conname = 'applications_workspace_source_case_fk' and conrelid = 'public.case_learning_applications'::regclass) then
    alter table public.case_learning_applications drop constraint applications_workspace_source_case_fk;
  end if;
  alter table public.case_learning_applications
    add constraint applications_workspace_source_case_fk
    foreign key (workspace_id, source_case_id) references public.cases(workspace_id, id) on delete cascade;

  if exists (select 1 from pg_constraint where conname = 'applications_workspace_source_outcome_fk' and conrelid = 'public.case_learning_applications'::regclass) then
    alter table public.case_learning_applications drop constraint applications_workspace_source_outcome_fk;
  end if;
  alter table public.case_learning_applications
    add constraint applications_workspace_source_outcome_fk
    foreign key (workspace_id, source_outcome_id) references public.case_outcomes(workspace_id, id) on delete cascade;
end $$;

-- Work-packet rows are immutable to callers, but FK cascades must still be
-- able to remove a deleted case's graph.  A direct child delete/update keeps
-- failing while a cascade is allowed only after an owning/reference parent is
-- already absent.  No trigger-disabling GUC or replication-role bypass is used.
create or replace function public.reject_case_work_packet_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'case work packet records are immutable';
  end if;

  if tg_table_name = 'case_stage_outputs' then
    if not exists (select 1 from public.cases where workspace_id = old.workspace_id and id = old.case_id)
       or not exists (select 1 from public.case_artifacts where workspace_id = old.workspace_id and id = old.artifact_id)
       or not exists (select 1 from public.execution_runs where workspace_id = old.workspace_id and id = old.execution_run_id) then
      return old;
    end if;
  elsif tg_table_name = 'case_learning_applications' then
    if not exists (select 1 from public.cases where workspace_id = old.workspace_id and id = old.case_id)
       or not exists (select 1 from public.case_artifacts where workspace_id = old.workspace_id and id = old.artifact_id)
       or not exists (select 1 from public.execution_runs where workspace_id = old.workspace_id and id = old.execution_run_id)
       or not exists (select 1 from public.learning_records where workspace_id = old.workspace_id and id = old.learning_id)
       or not exists (select 1 from public.cases where workspace_id = old.workspace_id and id = old.source_case_id)
       or (old.source_outcome_id is not null and not exists (select 1 from public.case_outcomes where workspace_id = old.workspace_id and id = old.source_outcome_id)) then
      return old;
    end if;
  end if;

  raise exception 'case work packet records are immutable';
end $$;

create or replace function public.begin_case_deletion(
  p_workspace_id uuid,
  p_case_id uuid,
  p_actor_id uuid,
  p_confirmation_title text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  actor_role public.member_role;
begin
  if p_workspace_id is null or p_case_id is null or p_actor_id is null or p_request_id is null or p_confirmation_title is null then
    raise exception 'case deletion unavailable';
  end if;

  -- The function is granted only to service_role; the API still passes the
  -- verified actor/workspace IDs and the checks below repeat that context.
  if not exists (
    select 1 from public.workspace_members
     where workspace_id = p_workspace_id and user_id = p_actor_id
  ) then
    raise exception 'case deletion unavailable';
  end if;
  select role into actor_role
    from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_actor_id;

  -- Lock the case first.  Action claims, upload reservations, and AI-run
  -- starts use this same lock order so no new work can cross the tombstone.
  select * into case_row
    from public.cases
   where id = p_case_id and workspace_id = p_workspace_id
   for update;
  if case_row.id is null then raise exception 'case deletion unavailable'; end if;
  if case_row.title is distinct from p_confirmation_title then raise exception 'case deletion unavailable'; end if;
  if case_row.created_by is distinct from p_actor_id and actor_role not in ('owner', 'admin') then
    raise exception 'case deletion unavailable';
  end if;

  if case_row.deletion_request_id is not null then
    if case_row.deletion_request_id is distinct from p_request_id then
      raise exception 'case deletion already requested';
    end if;
    return jsonb_build_object('request_id', case_row.deletion_request_id, 'tombstoned', true);
  end if;
  if case_row.status = 'cancelled' then raise exception 'case deletion unavailable'; end if;

  if exists (
    select 1 from public.case_actions
     where workspace_id = case_row.workspace_id and case_id = case_row.id and status = 'executing'
  ) then
    raise exception 'case deletion is busy';
  end if;
  if exists (
    select 1 from public.execution_runs
     where workspace_id = case_row.workspace_id and case_id = case_row.id and status = 'started'
  ) then
    raise exception 'case deletion is busy';
  end if;
  if exists (
    select 1 from public.source_items
     where workspace_id = case_row.workspace_id and case_id = case_row.id
       and source_kind = 'private_upload' and extraction_status = 'pending'
       and created_at >= now() - interval '10 minutes'
  ) then
    raise exception 'case deletion is busy';
  end if;

  update public.case_actions
     set status = 'cancelled'
   where workspace_id = case_row.workspace_id and case_id = case_row.id and status = 'pending';
  update public.learning_records
     set approved_for_reuse = false
   where workspace_id = case_row.workspace_id and case_id = case_row.id and approved_for_reuse;
  update public.cases
     set status = 'cancelled', deletion_request_id = p_request_id,
         deletion_requested_at = now(), deletion_requested_by = p_actor_id
   where id = case_row.id and workspace_id = case_row.workspace_id;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (case_row.workspace_id, p_actor_id, 'case.deletion_requested', 'case', case_row.id,
      jsonb_build_object('request_id', p_request_id));

  return jsonb_build_object('request_id', p_request_id, 'tombstoned', true);
end $$;

create or replace function public.start_case_execution_run(
  p_workspace_id uuid,
  p_case_id uuid,
  p_actor_id uuid,
  p_provider text,
  p_model text,
  p_estimated_cost_usd numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  run_id uuid;
begin
  if p_workspace_id is null or p_case_id is null or p_actor_id is null
     or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_id)
     or char_length(trim(coalesce(p_provider, ''))) not between 1 and 120
     or char_length(trim(coalesce(p_model, ''))) not between 1 and 240
     or coalesce(p_estimated_cost_usd, -1) < 0 then
    raise exception 'execution state unavailable';
  end if;
  select * into case_row from public.cases where id = p_case_id and workspace_id = p_workspace_id for update;
  if case_row.id is null or case_row.status in ('completed', 'cancelled') or case_row.deletion_request_id is not null then
    raise exception 'execution state unavailable';
  end if;
  insert into public.execution_runs(workspace_id, case_id, provider, model, status, estimated_cost_usd, created_by)
    values (case_row.workspace_id, case_row.id, left(trim(p_provider), 120), left(trim(p_model), 240), 'started', p_estimated_cost_usd, p_actor_id)
    returning id into run_id;
  return run_id;
end $$;

create or replace function public.finalize_case_deletion(
  p_workspace_id uuid,
  p_case_id uuid,
  p_actor_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  actor_role public.member_role;
begin
  if p_workspace_id is null or p_case_id is null or p_actor_id is null or p_request_id is null then
    raise exception 'case deletion unavailable';
  end if;
  select role into actor_role from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_id;
  select * into case_row from public.cases where id = p_case_id and workspace_id = p_workspace_id for update;
  if case_row.id is null or case_row.deletion_request_id is distinct from p_request_id
     or case_row.status <> 'cancelled'
     or (case_row.created_by is distinct from p_actor_id and actor_role not in ('owner', 'admin')) then
    raise exception 'case deletion unavailable';
  end if;
  if exists (select 1 from public.case_actions where workspace_id = case_row.workspace_id and case_id = case_row.id and status = 'executing')
     or exists (select 1 from public.execution_runs where workspace_id = case_row.workspace_id and case_id = case_row.id and status = 'started') then
    raise exception 'case deletion is busy';
  end if;

  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (case_row.workspace_id, p_actor_id, 'case.deleted', 'case', case_row.id,
      jsonb_build_object('request_id', p_request_id));
  delete from public.cases where id = case_row.id and workspace_id = case_row.workspace_id;
  return jsonb_build_object('case_id', p_case_id, 'request_id', p_request_id, 'deleted', true);
end $$;

-- The upload ticket authority takes the case lock before checking membership or
-- inserting a pending reservation, preventing a tombstoned case from gaining
-- a fresh private object during Storage cleanup.
create or replace function public.reserve_source_upload(
  p_workspace_id uuid,
  p_case_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  source_id uuid;
  case_row public.cases;
begin
  select * into case_row
    from public.cases
   where id = p_case_id and workspace_id = p_workspace_id
   for update;
  if case_row.id is null or case_row.deletion_request_id is not null or case_row.status = 'cancelled'
     or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id) then
    raise exception 'not authorized';
  end if;
  if p_storage_path not like p_workspace_id::text || '/' || p_case_id::text || '/%'
     or p_storage_path !~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$'
     or char_length(p_storage_path) > 360 or p_storage_path like '%..%' then
    raise exception 'invalid storage path';
  end if;
  if p_byte_size <= 0 or p_byte_size > 10485760 then raise exception 'source size limit exceeded'; end if;
  if p_mime_type not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown') then raise exception 'unsupported source type'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_case_id::text, 0));
  if (select count(*) from public.source_items where case_id = p_case_id and source_kind = 'private_upload' and extraction_status <> 'failed') >= 5 then
    raise exception 'source limit reached';
  end if;
  insert into public.source_items(workspace_id, case_id, source_kind, storage_path, filename, mime_type, byte_size, sha256, extraction_status, created_by)
    values (p_workspace_id, p_case_id, 'private_upload', p_storage_path, left(p_filename, 255), p_mime_type, p_byte_size, null, 'pending', p_user_id)
    returning id into source_id;
  return source_id;
end $$;

revoke all on function public.begin_case_deletion(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.start_case_execution_run(uuid, uuid, uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.finalize_case_deletion(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reserve_source_upload(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.begin_case_deletion(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.start_case_execution_run(uuid, uuid, uuid, text, text, numeric) to service_role;
grant execute on function public.finalize_case_deletion(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.reserve_source_upload(uuid, uuid, uuid, text, text, text, bigint) to service_role;
