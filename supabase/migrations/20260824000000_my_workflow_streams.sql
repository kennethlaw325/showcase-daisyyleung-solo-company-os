-- My Workflow v1 is a bounded, versioned preset layer over the three
-- canonical modules. It never owns prompts, output schemas, approval gates,
-- or connector behaviour.

create table public.workflow_streams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_id uuid not null default gen_random_uuid(),
  version integer not null check (version > 0),
  base_module public.module_key not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  goal_mode text not null default 'outcome' check (goal_mode in ('outcome', 'decision', 'project', 'checklist')),
  intake_defaults jsonb not null default '{}'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  stage_visibility jsonb not null default '{"intake":true,"artifact":true,"approval":true,"gmail":true,"outcome":true}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (group_id, version)
);

create unique index workflow_streams_one_active_group_idx
  on public.workflow_streams(group_id)
  where status = 'active';
create index workflow_streams_workspace_status_idx
  on public.workflow_streams(workspace_id, status, updated_at desc);

alter table public.cases
  add column if not exists workflow_stream_id uuid,
  add column if not exists workflow_stream_version integer,
  add column if not exists workflow_stream_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cases_workflow_stream_workspace_fk'
      and conrelid = 'public.cases'::regclass
  ) then
    alter table public.cases
      add constraint cases_workflow_stream_workspace_fk
      foreign key (workspace_id, workflow_stream_id)
      references public.workflow_streams(workspace_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'cases_workflow_stream_snapshot_check'
      and conrelid = 'public.cases'::regclass
  ) then
    alter table public.cases
      add constraint cases_workflow_stream_snapshot_check check (
        (workflow_stream_id is null and workflow_stream_version is null and workflow_stream_hash is null)
        or (workflow_stream_id is not null and workflow_stream_version is not null and workflow_stream_version > 0 and workflow_stream_hash ~ '^[a-f0-9]{64}$')
      );
  end if;
end $$;

create or replace function public.workflow_stream_payload_hash(
  p_base_module public.module_key,
  p_name text,
  p_description text,
  p_goal_mode text,
  p_intake_defaults jsonb,
  p_checklist jsonb,
  p_stage_visibility jsonb
) returns text
language sql
immutable
strict
set search_path = public
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'base_module', p_base_module::text,
    'name', trim(p_name),
    'description', trim(coalesce(p_description, '')),
    'goal_mode', p_goal_mode,
    'intake_defaults', p_intake_defaults,
    'checklist', p_checklist,
    'stage_visibility', p_stage_visibility
  )::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.validate_workflow_stream_payload(
  p_name text,
  p_description text,
  p_goal_mode text,
  p_intake_defaults jsonb,
  p_checklist jsonb,
  p_stage_visibility jsonb
) returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  item jsonb;
  key_name text;
  item_id text;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'invalid workflow name'; end if;
  if char_length(coalesce(p_description, '')) > 2000 then raise exception 'invalid workflow description'; end if;
  if p_goal_mode not in ('outcome', 'decision', 'project', 'checklist') then raise exception 'invalid workflow goal mode'; end if;

  if p_intake_defaults is null or jsonb_typeof(p_intake_defaults) <> 'object' or octet_length(p_intake_defaults::text) > 50000 then
    raise exception 'invalid workflow intake defaults';
  end if;
  for key_name in select jsonb_object_keys(p_intake_defaults) loop
    if key_name not in ('schemaVersion', 'successCriteria', 'workflowGuidance', 'offer', 'leadProfile', 'pipelineContext', 'campaignContext', 'conversionTarget', 'decisionsNeeded', 'owners', 'deadlines', 'sopContext', 'blockers', 'crossFunctionalSignals', 'audiencePreset', 'knowledgeLevel', 'audienceGoal', 'tone', 'format', 'disclosureBoundaries') then
      raise exception 'workflow intake defaults contain an unsupported field';
    end if;
    if jsonb_typeof(p_intake_defaults -> key_name) not in ('string', 'array', 'number') then
      raise exception 'workflow intake defaults must contain bounded text or text lists';
    end if;
    if jsonb_typeof(p_intake_defaults -> key_name) = 'array'
      and exists (select 1 from jsonb_array_elements(p_intake_defaults -> key_name) value where jsonb_typeof(value) <> 'string') then
      raise exception 'workflow intake default lists must contain text';
    end if;
  end loop;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' or jsonb_array_length(p_checklist) > 30 then
    raise exception 'invalid workflow checklist';
  end if;
  for item in select value from jsonb_array_elements(p_checklist) as value loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'id') or not (item ? 'label') or not (item ? 'required')
      or exists (select 1 from jsonb_object_keys(item) key where key not in ('id', 'label', 'required')) then
      raise exception 'workflow checklist items must contain only id, label, and required';
    end if;
    item_id := item ->> 'id';
    if item_id is null or item_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or char_length(trim(item ->> 'label')) not between 1 and 200 or jsonb_typeof(item -> 'required') <> 'boolean' then
      raise exception 'invalid workflow checklist item';
    end if;
  end loop;

  if p_stage_visibility is null or jsonb_typeof(p_stage_visibility) <> 'object' then raise exception 'invalid workflow stage visibility'; end if;
  for key_name in select jsonb_object_keys(p_stage_visibility) loop
    if key_name not in ('intake', 'artifact', 'approval', 'gmail', 'outcome') or jsonb_typeof(p_stage_visibility -> key_name) <> 'boolean' then
      raise exception 'invalid workflow stage visibility';
    end if;
    if key_name <> 'gmail' and (p_stage_visibility -> key_name) <> 'true'::jsonb then
      raise exception 'workflow safety gates cannot be disabled';
    end if;
  end loop;
end $$;

create or replace function public.reject_workflow_stream_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.group_id is distinct from old.group_id
    or new.version is distinct from old.version
    or new.base_module is distinct from old.base_module
    or new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.goal_mode is distinct from old.goal_mode
    or new.intake_defaults is distinct from old.intake_defaults
    or new.checklist is distinct from old.checklist
    or new.stage_visibility is distinct from old.stage_visibility
    or new.content_hash is distinct from old.content_hash
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'workflow stream versions are immutable';
  end if;
  if old.status = 'archived' and new.status is distinct from old.status then raise exception 'archived workflow stream is immutable'; end if;
  if old.status = 'active' and new.status not in ('active', 'archived') then raise exception 'invalid workflow stream status'; end if;
  return new;
end $$;

drop trigger if exists workflow_streams_touch_updated_at on public.workflow_streams;
create trigger workflow_streams_touch_updated_at before update on public.workflow_streams for each row execute function public.touch_updated_at();
drop trigger if exists workflow_streams_immutable on public.workflow_streams;
create trigger workflow_streams_immutable before update on public.workflow_streams for each row execute function public.reject_workflow_stream_mutation();

create or replace function public.reject_case_workflow_stream_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.workflow_stream_id is distinct from old.workflow_stream_id
    or new.workflow_stream_version is distinct from old.workflow_stream_version
    or new.workflow_stream_hash is distinct from old.workflow_stream_hash then
    raise exception 'case workflow stream binding is immutable';
  end if;
  return new;
end $$;

drop trigger if exists cases_workflow_stream_immutable on public.cases;
create trigger cases_workflow_stream_immutable before update on public.cases for each row execute function public.reject_case_workflow_stream_mutation();

create or replace function public.create_workflow_stream(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_base_module public.module_key,
  p_name text,
  p_description text,
  p_goal_mode text,
  p_intake_defaults jsonb,
  p_checklist jsonb,
  p_stage_visibility jsonb
) returns public.workflow_streams
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.workflow_streams;
  stream_group_id uuid := gen_random_uuid();
  computed_hash text;
begin
  if p_actor_id is null or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_id) then raise exception 'workflow not authorized'; end if;
  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then raise exception 'workflow actor mismatch'; end if;
  perform public.validate_workflow_stream_payload(p_name, p_description, p_goal_mode, p_intake_defaults, p_checklist, p_stage_visibility);
  computed_hash := public.workflow_stream_payload_hash(p_base_module, p_name, p_description, p_goal_mode, p_intake_defaults, p_checklist, p_stage_visibility);
  insert into public.workflow_streams(workspace_id, group_id, version, base_module, name, description, goal_mode, intake_defaults, checklist, stage_visibility, status, content_hash, created_by)
  values (p_workspace_id, stream_group_id, 1, p_base_module, trim(p_name), trim(coalesce(p_description, '')), p_goal_mode, p_intake_defaults, p_checklist, p_stage_visibility, 'active', computed_hash, p_actor_id)
  returning * into result;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, p_actor_id, 'workflow_stream.created', 'workflow_stream', result.id,
    jsonb_build_object('group_id', result.group_id, 'version', result.version, 'content_hash', result.content_hash, 'base_module', result.base_module::text));
  return result;
end $$;

create or replace function public.revise_workflow_stream(
  p_stream_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_base_module public.module_key,
  p_name text,
  p_description text,
  p_goal_mode text,
  p_intake_defaults jsonb,
  p_checklist jsonb,
  p_stage_visibility jsonb
) returns public.workflow_streams
language plpgsql
security definer
set search_path = public
as $$
declare
  previous public.workflow_streams;
  result public.workflow_streams;
  computed_hash text;
begin
  select * into previous from public.workflow_streams where id = p_stream_id for update;
  if previous.id is null or previous.status <> 'active' then raise exception 'workflow stream is unavailable'; end if;
  if p_expected_version is distinct from previous.version then raise exception 'stale workflow stream version'; end if;
  if p_actor_id is null or not exists (select 1 from public.workspace_members where workspace_id = previous.workspace_id and user_id = p_actor_id) then raise exception 'workflow not authorized'; end if;
  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then raise exception 'workflow actor mismatch'; end if;
  if p_base_module is distinct from previous.base_module then raise exception 'workflow base module cannot change'; end if;
  perform public.validate_workflow_stream_payload(p_name, p_description, p_goal_mode, p_intake_defaults, p_checklist, p_stage_visibility);
  computed_hash := public.workflow_stream_payload_hash(p_base_module, p_name, p_description, p_goal_mode, p_intake_defaults, p_checklist, p_stage_visibility);
  update public.workflow_streams set status = 'archived' where id = previous.id;
  insert into public.workflow_streams(workspace_id, group_id, version, base_module, name, description, goal_mode, intake_defaults, checklist, stage_visibility, status, content_hash, created_by)
  values (previous.workspace_id, previous.group_id, previous.version + 1, p_base_module, trim(p_name), trim(coalesce(p_description, '')), p_goal_mode, p_intake_defaults, p_checklist, p_stage_visibility, 'active', computed_hash, p_actor_id)
  returning * into result;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (previous.workspace_id, p_actor_id, 'workflow_stream.revised', 'workflow_stream', result.id,
    jsonb_build_object('group_id', result.group_id, 'from_stream_id', previous.id, 'from_version', previous.version, 'version', result.version, 'content_hash', result.content_hash));
  return result;
end $$;

create or replace function public.archive_workflow_stream(
  p_stream_id uuid,
  p_expected_version integer,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stream_row public.workflow_streams;
begin
  select * into stream_row from public.workflow_streams where id = p_stream_id for update;
  if stream_row.id is null or stream_row.status <> 'active' then raise exception 'workflow stream is unavailable'; end if;
  if p_expected_version is distinct from stream_row.version then raise exception 'stale workflow stream version'; end if;
  if p_actor_id is null or not exists (select 1 from public.workspace_members where workspace_id = stream_row.workspace_id and user_id = p_actor_id) then raise exception 'workflow not authorized'; end if;
  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then raise exception 'workflow actor mismatch'; end if;
  update public.workflow_streams set status = 'archived' where id = stream_row.id;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (stream_row.workspace_id, p_actor_id, 'workflow_stream.archived', 'workflow_stream', stream_row.id,
    jsonb_build_object('group_id', stream_row.group_id, 'version', stream_row.version, 'content_hash', stream_row.content_hash));
  return true;
end $$;

create or replace function public.create_case_with_workflow_stream(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_module public.module_key,
  p_template_version integer,
  p_title text,
  p_brief text,
  p_intake_context jsonb,
  p_workflow_stream_id uuid,
  p_expected_stream_version integer
) returns public.cases
language plpgsql
security definer
set search_path = public
as $$
declare
  stream_row public.workflow_streams;
  result public.cases;
begin
  if p_actor_id is null or not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_id) then raise exception 'case not authorized'; end if;
  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then raise exception 'case actor mismatch'; end if;
  select * into stream_row from public.workflow_streams where id = p_workflow_stream_id and workspace_id = p_workspace_id for share;
  if stream_row.id is null or stream_row.status <> 'active' then raise exception 'workflow stream is unavailable'; end if;
  if p_expected_stream_version is distinct from stream_row.version then raise exception 'stale workflow stream version'; end if;
  if p_module is distinct from stream_row.base_module then raise exception 'workflow stream module mismatch'; end if;
  if p_template_version is null or p_template_version <= 0 then raise exception 'invalid template version'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'invalid case title'; end if;
  if p_brief is null or char_length(trim(p_brief)) not between 1 and 20000 then raise exception 'invalid case brief'; end if;
  if p_intake_context is null or jsonb_typeof(p_intake_context) <> 'object' or octet_length(p_intake_context::text) > 200000 or p_intake_context ? 'module' then raise exception 'invalid case intake context'; end if;
  if public.jsonb_has_key_recursive(p_intake_context, 'module') then raise exception 'invalid case intake context'; end if;
  insert into public.cases(workspace_id, module, template_key, template_version, title, brief, intake_context, status, current_revision, created_by, workflow_stream_id, workflow_stream_version, workflow_stream_hash)
  values (p_workspace_id, p_module, p_module, p_template_version, trim(p_title), trim(p_brief), p_intake_context, 'draft', 0, p_actor_id, stream_row.id, stream_row.version, stream_row.content_hash)
  returning * into result;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, p_actor_id, 'case.workflow_stream_bound', 'case', result.id,
    jsonb_build_object('workflow_stream_id', stream_row.id, 'workflow_stream_version', stream_row.version, 'workflow_stream_hash', stream_row.content_hash, 'base_module', stream_row.base_module::text));
  return result;
end $$;

alter table public.workflow_streams enable row level security;
create policy workflow_streams_member_select on public.workflow_streams for select using (public.is_workspace_member(workspace_id));

revoke all privileges on table public.workflow_streams from public, anon, authenticated, service_role;
grant select on table public.workflow_streams to authenticated, service_role;

revoke all on function public.workflow_stream_payload_hash(public.module_key, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.validate_workflow_stream_payload(text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.create_workflow_stream(uuid, uuid, public.module_key, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.revise_workflow_stream(uuid, integer, uuid, public.module_key, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.archive_workflow_stream(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.create_case_with_workflow_stream(uuid, uuid, public.module_key, integer, text, text, jsonb, uuid, integer) from public, anon, authenticated;
grant execute on function public.create_workflow_stream(uuid, uuid, public.module_key, text, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.revise_workflow_stream(uuid, integer, uuid, public.module_key, text, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.archive_workflow_stream(uuid, integer, uuid) to service_role;
grant execute on function public.create_case_with_workflow_stream(uuid, uuid, public.module_key, integer, text, text, jsonb, uuid, integer)
  to authenticated, service_role;
