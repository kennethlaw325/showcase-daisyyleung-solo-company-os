-- Next-phase capabilities: immutable intake provenance, opt-in edit learning,
-- tenant-scoped clients, bounded imports, and deduplicated re-analysis.

create table public.case_intake_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 250000),
  semantic_payload_hash text not null check (semantic_payload_hash ~ '^[a-f0-9]{64}$'),
  snapshot_status text not null default 'exact' check (snapshot_status in ('exact', 'partial_legacy')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, case_id),
  foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade
);
create index case_intake_snapshots_workspace_created_idx on public.case_intake_snapshots(workspace_id, created_at desc);

create table public.writing_style_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object' and octet_length(rules::text) <= 20000),
  profile_version integer not null default 1 check (profile_version > 0),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create table public.artifact_edit_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null,
  revision_before integer not null check (revision_before > 0),
  revision_after integer not null check (revision_after > revision_before),
  previous_content_hash text not null check (previous_content_hash ~ '^[a-f0-9]{64}$'),
  edited_content_hash text not null check (edited_content_hash ~ '^[a-f0-9]{64}$'),
  structural_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(structural_metadata) = 'object' and octet_length(structural_metadata::text) <= 12000),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'discarded')),
  created_by uuid not null references auth.users(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, case_id, revision_after),
  foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade
);
create index artifact_edit_signals_workspace_status_idx on public.artifact_edit_signals(workspace_id, status, created_at desc);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  company text not null default '' check (char_length(company) <= 160),
  status text not null default 'active' check (status in ('active', 'archived')),
  notes text not null default '' check (char_length(notes) <= 5000),
  contact_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(contact_metadata) = 'object' and octet_length(contact_metadata::text) <= 12000),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create index clients_workspace_status_idx on public.clients(workspace_id, status, updated_at desc);

alter table public.cases add column if not exists client_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cases_client_workspace_fk' and conrelid = 'public.cases'::regclass) then
    alter table public.cases add constraint cases_client_workspace_fk foreign key (workspace_id, client_id) references public.clients(workspace_id, id) on delete set null;
  end if;
end $$;
create index cases_workspace_client_idx on public.cases(workspace_id, client_id, updated_at desc);

create table public.case_reanalysis_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null,
  trigger_type text not null check (trigger_type in ('manual', 'source_added')),
  source_state_hash text not null check (source_state_hash ~ '^[a-f0-9]{64}$'),
  base_revision integer not null check (base_revision >= 0),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'superseded', 'cancelled')),
  resulting_revision integer,
  result_delta jsonb check (result_delta is null or (jsonb_typeof(result_delta) = 'object' and octet_length(result_delta::text) <= 30000)),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,80}$'),
  actor_id uuid not null references auth.users(id),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade
);
create unique index case_reanalysis_one_open_state_idx on public.case_reanalysis_requests(workspace_id, case_id, source_state_hash)
  where status in ('queued', 'running');
create unique index case_reanalysis_idempotency_idx on public.case_reanalysis_requests(workspace_id, idempotency_key);
create index case_reanalysis_case_created_idx on public.case_reanalysis_requests(workspace_id, case_id, created_at desc);

create or replace function public.reject_case_intake_snapshot_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'case intake snapshots are immutable';
end $$;
create trigger case_intake_snapshots_immutable
before update or delete on public.case_intake_snapshots
for each row execute function public.reject_case_intake_snapshot_mutation();

create or replace function public.reject_style_signal_history_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.workspace_id is distinct from new.workspace_id
    or old.case_id is distinct from new.case_id
    or old.revision_before is distinct from new.revision_before
    or old.revision_after is distinct from new.revision_after
    or old.previous_content_hash is distinct from new.previous_content_hash
    or old.edited_content_hash is distinct from new.edited_content_hash
    or old.structural_metadata is distinct from new.structural_metadata
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at then
    raise exception 'edit signal provenance is immutable';
  end if;
  return new;
end $$;
create trigger artifact_edit_signals_immutable_provenance
before update on public.artifact_edit_signals
for each row execute function public.reject_style_signal_history_mutation();

create or replace function public.case_source_state_hash(p_case_id uuid)
returns text language sql stable set search_path = public as $$
  select encode(extensions.digest(convert_to(coalesce(
    (select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'sha256', s.sha256,
      'status', s.extraction_status,
      'filename', s.filename,
      'byte_size', s.byte_size
    ) order by s.id) from public.source_items s where s.case_id = p_case_id), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.enqueue_case_reanalysis(
  p_case_id uuid,
  p_actor_id uuid,
  p_trigger_type text,
  p_source_state_hash text default null,
  p_expected_revision integer default null,
  p_idempotency_key text default null
) returns public.case_reanalysis_requests
language plpgsql security definer set search_path = public as $$
declare
  case_row public.cases;
  state_hash text;
  existing public.case_reanalysis_requests;
  result public.case_reanalysis_requests;
begin
  select * into case_row from public.cases where id = p_case_id for update;
  if case_row.id is null or not exists (select 1 from public.workspace_members m where m.workspace_id = case_row.workspace_id and m.user_id = p_actor_id) then raise exception 'reanalysis not authorized'; end if;
  state_hash := coalesce(nullif(p_source_state_hash, ''), public.case_source_state_hash(p_case_id));
  if state_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid source state hash'; end if;
  if p_expected_revision is not null and p_expected_revision <> case_row.current_revision then raise exception 'stale reanalysis revision'; end if;
  select * into existing from public.case_reanalysis_requests r where r.workspace_id = case_row.workspace_id and r.case_id = p_case_id and r.source_state_hash = state_hash and r.status in ('queued','running') order by r.created_at desc limit 1;
  if existing.id is not null then return existing; end if;
  insert into public.case_reanalysis_requests(workspace_id, case_id, trigger_type, source_state_hash, base_revision, actor_id, idempotency_key)
  values (case_row.workspace_id, p_case_id, p_trigger_type, state_hash, case_row.current_revision, p_actor_id, coalesce(nullif(p_idempotency_key, ''), 'reanalysis:' || p_case_id::text || ':' || state_hash))
  on conflict (workspace_id, idempotency_key) do update set updated_at = now()
  returning * into result;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (case_row.workspace_id, p_actor_id, 'case_reanalysis.queued', 'case', p_case_id, jsonb_build_object('request_id', result.id, 'trigger_type', p_trigger_type, 'source_state_hash', state_hash, 'base_revision', case_row.current_revision));
  return result;
end $$;

create or replace function public.record_case_intake_snapshot(
  p_case_id uuid,
  p_actor_id uuid,
  p_payload jsonb,
  p_snapshot_status text default 'exact'
) returns public.case_intake_snapshots
language plpgsql security definer set search_path = public as $$
declare
  case_row public.cases;
  result public.case_intake_snapshots;
  computed_hash text;
  key_name text;
  manifest_item jsonb;
begin
  select * into case_row from public.cases where id = p_case_id;
  if case_row.id is null or not exists (select 1 from public.workspace_members m where m.workspace_id = case_row.workspace_id and m.user_id = p_actor_id) then raise exception 'snapshot not authorized'; end if;
  if p_snapshot_status not in ('exact', 'partial_legacy') or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 250000 then raise exception 'invalid intake snapshot'; end if;
  if p_payload->>'schemaVersion' <> '1' or not (p_payload ? 'title') or not (p_payload ? 'objective') or not (p_payload ? 'module') or not (p_payload ? 'moduleContext') or not (p_payload ? 'sourceManifest') then raise exception 'invalid intake snapshot'; end if;
  for key_name in select jsonb_object_keys(p_payload) loop
    if key_name not in ('schemaVersion','title','objective','module','moduleContext','audience','selectedLearningIds','sourceManifest') then raise exception 'invalid intake snapshot field'; end if;
  end loop;
  if jsonb_typeof(p_payload->'moduleContext') <> 'object' or jsonb_typeof(p_payload->'sourceManifest') <> 'array' or jsonb_array_length(p_payload->'sourceManifest') > 5 then raise exception 'invalid intake snapshot manifest'; end if;
  for manifest_item in select value from jsonb_array_elements(p_payload->'sourceManifest') value loop
    if jsonb_typeof(manifest_item) <> 'object' or not (manifest_item ? 'kind') or not (manifest_item ? 'filename') or exists (select 1 from jsonb_object_keys(manifest_item) key where key not in ('kind','filename','sha256','byteSize','urlHost')) then raise exception 'invalid intake snapshot manifest item'; end if;
    if manifest_item->>'kind' not in ('upload','url','pasted') or char_length(trim(manifest_item->>'filename')) not between 1 and 255 then raise exception 'invalid intake snapshot manifest item'; end if;
    if manifest_item ? 'sha256' and (manifest_item->>'sha256') !~ '^[a-f0-9]{64}$' then raise exception 'invalid intake snapshot manifest hash'; end if;
  end loop;
  computed_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.case_intake_snapshots(workspace_id, case_id, payload, semantic_payload_hash, snapshot_status, created_by)
  values (case_row.workspace_id, p_case_id, p_payload, computed_hash, p_snapshot_status, p_actor_id)
  on conflict (workspace_id, case_id) do nothing
  returning * into result;
  if result.id is null then select * into result from public.case_intake_snapshots where workspace_id = case_row.workspace_id and case_id = p_case_id; end if;
  if result.snapshot_status <> p_snapshot_status or result.semantic_payload_hash <> computed_hash then raise exception 'intake snapshot conflict'; end if;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (case_row.workspace_id, p_actor_id, 'case_intake_snapshot.created', 'case', p_case_id, jsonb_build_object('snapshot_id', result.id, 'snapshot_status', result.snapshot_status, 'semantic_payload_hash', result.semantic_payload_hash));
  return result;
end $$;

create or replace function public.create_artifact_edit_signal(
  p_case_id uuid,
  p_actor_id uuid,
  p_revision_before integer,
  p_revision_after integer,
  p_previous_content_hash text,
  p_edited_content_hash text,
  p_structural_metadata jsonb default '{}'::jsonb
) returns public.artifact_edit_signals
language plpgsql security definer set search_path = public as $$
declare
  case_row public.cases;
  signal public.artifact_edit_signals;
begin
  select * into case_row from public.cases where id = p_case_id;
  if case_row.id is null or not exists (select 1 from public.workspace_members m where m.workspace_id = case_row.workspace_id and m.user_id = p_actor_id) then raise exception 'style signal not authorized'; end if;
  if p_revision_after <> case_row.current_revision or p_revision_after <= p_revision_before or p_previous_content_hash !~ '^[a-f0-9]{64}$' or p_edited_content_hash !~ '^[a-f0-9]{64}$' or p_structural_metadata is null or jsonb_typeof(p_structural_metadata) <> 'object' or octet_length(p_structural_metadata::text) > 12000 then raise exception 'invalid style signal'; end if;
  insert into public.artifact_edit_signals(workspace_id, case_id, revision_before, revision_after, previous_content_hash, edited_content_hash, structural_metadata, created_by)
  values (case_row.workspace_id, p_case_id, p_revision_before, p_revision_after, p_previous_content_hash, p_edited_content_hash, p_structural_metadata, p_actor_id)
  on conflict (workspace_id, case_id, revision_after) do nothing
  returning * into signal;
  if signal.id is null then
    select * into signal from public.artifact_edit_signals where workspace_id = case_row.workspace_id and case_id = p_case_id and revision_after = p_revision_after;
  end if;
  return signal;
end $$;

create or replace function public.resolve_artifact_edit_signal(
  p_signal_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_rules jsonb default '{}'::jsonb
) returns public.artifact_edit_signals
language plpgsql security definer set search_path = public as $$
declare
  signal public.artifact_edit_signals;
  profile public.writing_style_profiles;
begin
  select * into signal from public.artifact_edit_signals where id = p_signal_id for update;
  if signal.id is null or not exists (select 1 from public.workspace_members m where m.workspace_id = signal.workspace_id and m.user_id = p_actor_id) then raise exception 'style signal not authorized'; end if;
  if signal.status <> 'pending' then return signal; end if;
  if p_decision not in ('confirm','discard') then raise exception 'invalid style decision'; end if;
  if p_decision = 'discard' then update public.artifact_edit_signals set status = 'discarded', confirmed_by = p_actor_id, confirmed_at = now() where id = signal.id returning * into signal; return signal; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' or octet_length(p_rules::text) > 12000 then raise exception 'invalid style rules'; end if;
  insert into public.writing_style_profiles(workspace_id, rules, profile_version, active, created_by, updated_by)
  values (signal.workspace_id, p_rules, 1, true, p_actor_id, p_actor_id)
  on conflict (workspace_id) do update set rules = public.writing_style_profiles.rules || excluded.rules, profile_version = public.writing_style_profiles.profile_version + 1, active = true, updated_by = p_actor_id, updated_at = now()
  returning * into profile;
  update public.artifact_edit_signals set status = 'confirmed', confirmed_by = p_actor_id, confirmed_at = now() where id = signal.id returning * into signal;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (signal.workspace_id, p_actor_id, 'writing_style_profile.confirmed', 'artifact_edit_signal', signal.id, jsonb_build_object('profile_id', profile.id, 'profile_version', profile.profile_version));
  return signal;
end $$;

create or replace function public.create_client(
  p_workspace_id uuid, p_name text, p_company text default '', p_notes text default '', p_contact_metadata jsonb default '{}'::jsonb
) returns public.clients
language plpgsql security definer set search_path = public as $$
declare result public.clients; workspace_id uuid;
begin
  if p_workspace_id is null or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  ) then raise exception 'client not authorized'; end if;
  workspace_id := p_workspace_id;
  insert into public.clients(workspace_id,name,company,notes,contact_metadata,created_by,updated_by) values (workspace_id,trim(p_name),trim(coalesce(p_company,'')),coalesce(p_notes,''),coalesce(p_contact_metadata,'{}'::jsonb),auth.uid(),auth.uid()) returning * into result;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata) values (workspace_id,auth.uid(),'client.created','client',result.id,jsonb_build_object('status',result.status));
  return result;
end $$;

create or replace function public.update_client(
  p_client_id uuid, p_name text, p_company text default '', p_notes text default '', p_contact_metadata jsonb default '{}'::jsonb, p_status text default 'active'
) returns public.clients
language plpgsql security definer set search_path = public as $$
declare result public.clients;
begin
  update public.clients set name=trim(p_name),company=trim(coalesce(p_company,'')),notes=coalesce(p_notes,''),contact_metadata=coalesce(p_contact_metadata,'{}'::jsonb),status=p_status,updated_by=auth.uid(),updated_at=now() where id=p_client_id and public.is_workspace_member(workspace_id) returning * into result;
  if result.id is null then raise exception 'client unavailable'; end if;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata) values (result.workspace_id,auth.uid(),'client.updated','client',result.id,jsonb_build_object('status',result.status));
  return result;
end $$;

create or replace function public.archive_client(p_client_id uuid)
returns public.clients language plpgsql security definer set search_path = public as $$
declare result public.clients;
begin
  update public.clients set status='archived',updated_by=auth.uid(),updated_at=now() where id=p_client_id and public.is_workspace_member(workspace_id) returning * into result;
  if result.id is null then raise exception 'client unavailable'; end if;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata) values (result.workspace_id,auth.uid(),'client.archived','client',result.id,'{}'::jsonb);
  return result;
end $$;

create or replace function public.link_case_client(p_case_id uuid, p_client_id uuid default null)
returns public.cases language plpgsql security definer set search_path = public as $$
declare result public.cases; case_workspace uuid;
begin
  select workspace_id into case_workspace from public.cases where id = p_case_id;
  if case_workspace is null or not public.is_workspace_member(case_workspace) then raise exception 'case unavailable'; end if;
  if p_client_id is not null and not exists (select 1 from public.clients c where c.id = p_client_id and c.workspace_id = case_workspace and c.status = 'active') then raise exception 'client unavailable'; end if;
  update public.cases set client_id = p_client_id where id = p_case_id and workspace_id = case_workspace returning * into result;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata) values (case_workspace,auth.uid(),'case.client_linked','case',p_case_id,jsonb_build_object('client_id',p_client_id));
  return result;
end $$;

create or replace function public.enqueue_reanalysis_on_source_extraction()
returns trigger language plpgsql security definer set search_path = public as $$
declare case_row public.cases; state_hash text;
begin
  if new.extraction_status = 'extracted' then
    if tg_op = 'UPDATE' and old.extraction_status is not distinct from new.extraction_status then return new; end if;
    select * into case_row from public.cases where id = new.case_id;
    -- Initial intake evidence belongs to revision zero; only later evidence
    -- represents new information for an existing analysis.
    if case_row.id is not null and case_row.current_revision > 0 then
      state_hash := public.case_source_state_hash(new.case_id);
      insert into public.case_reanalysis_requests(workspace_id,case_id,trigger_type,source_state_hash,base_revision,actor_id,idempotency_key)
      values (new.workspace_id,new.case_id,'source_added',state_hash,case_row.current_revision,new.created_by,'reanalysis:'||new.case_id::text||':'||state_hash)
      on conflict (workspace_id,idempotency_key) do nothing;
    end if;
  end if;
  return new;
end $$;
create trigger source_items_enqueue_reanalysis after insert or update of extraction_status on public.source_items
for each row execute function public.enqueue_reanalysis_on_source_extraction();

create or replace function public.start_case_reanalysis(p_request_id uuid, p_actor_id uuid)
returns public.case_reanalysis_requests
language plpgsql security definer set search_path = public as $$
declare request_row public.case_reanalysis_requests; case_row public.cases; current_hash text;
begin
  select * into request_row from public.case_reanalysis_requests where id = p_request_id for update;
  select * into case_row from public.cases where id = request_row.case_id for update;
  if request_row.id is null or case_row.id is null or request_row.workspace_id <> case_row.workspace_id or not exists (select 1 from public.workspace_members m where m.workspace_id = case_row.workspace_id and m.user_id = p_actor_id) then raise exception 'reanalysis not authorized'; end if;
  if case_row.status in ('completed','outcome_pending') then raise exception 'reanalysis follow_up_only'; end if;
  current_hash := public.case_source_state_hash(case_row.id);
  if request_row.status <> 'queued' or request_row.base_revision <> case_row.current_revision or request_row.source_state_hash <> current_hash then
    update public.case_reanalysis_requests set status='superseded', error_code='stale_source_or_revision', completed_at=now(), updated_at=now() where id=request_row.id returning * into request_row;
    insert into public.case_reanalysis_requests(workspace_id,case_id,trigger_type,source_state_hash,base_revision,actor_id,idempotency_key)
    values (case_row.workspace_id,case_row.id,'source_added',current_hash,case_row.current_revision,p_actor_id,'reanalysis:'||case_row.id::text||':'||current_hash)
    on conflict (workspace_id,idempotency_key) do nothing;
    return request_row;
  end if;
  update public.case_reanalysis_requests set status='running', started_at=now(), updated_at=now() where id=request_row.id returning * into request_row;
  return request_row;
end $$;

create or replace function public.complete_case_reanalysis(
  p_request_id uuid,
  p_actor_id uuid,
  p_resulting_revision integer,
  p_result_delta jsonb
) returns public.case_reanalysis_requests
language plpgsql security definer set search_path = public as $$
declare request_row public.case_reanalysis_requests; case_row public.cases; current_hash text;
begin
  select * into request_row from public.case_reanalysis_requests where id=p_request_id for update;
  select * into case_row from public.cases where id=request_row.case_id;
  if request_row.id is null or case_row.id is null or request_row.workspace_id <> case_row.workspace_id or not exists (select 1 from public.workspace_members m where m.workspace_id=case_row.workspace_id and m.user_id=p_actor_id) then raise exception 'reanalysis not authorized'; end if;
  current_hash := public.case_source_state_hash(case_row.id);
  if request_row.status <> 'running' or request_row.base_revision >= p_resulting_revision or case_row.current_revision <> p_resulting_revision or current_hash <> request_row.source_state_hash then
    if request_row.status = 'running' and current_hash <> request_row.source_state_hash then
      update public.case_reanalysis_requests set status='superseded', error_code='stale_source_or_revision', completed_at=now(), updated_at=now() where id=request_row.id;
      insert into public.case_reanalysis_requests(workspace_id,case_id,trigger_type,source_state_hash,base_revision,actor_id,idempotency_key)
      values (case_row.workspace_id,case_row.id,'source_added',current_hash,case_row.current_revision,p_actor_id,'reanalysis:'||case_row.id::text||':'||current_hash)
      on conflict (workspace_id,idempotency_key) do nothing;
    end if;
    raise exception 'stale reanalysis completion';
  end if;
  if p_result_delta is null or jsonb_typeof(p_result_delta) <> 'object' or octet_length(p_result_delta::text) > 30000 then raise exception 'invalid reanalysis delta'; end if;
  update public.case_reanalysis_requests set status='completed', resulting_revision=p_resulting_revision, result_delta=p_result_delta, completed_at=now(), updated_at=now() where id=request_row.id returning * into request_row;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,metadata) values (request_row.workspace_id,p_actor_id,'case_reanalysis.completed','case',request_row.case_id,jsonb_build_object('request_id',request_row.id,'resulting_revision',p_resulting_revision));
  return request_row;
end $$;

create or replace function public.fail_case_reanalysis(p_request_id uuid, p_actor_id uuid, p_error_code text)
returns public.case_reanalysis_requests
language plpgsql security definer set search_path = public as $$
declare request_row public.case_reanalysis_requests;
begin
  select * into request_row from public.case_reanalysis_requests where id=p_request_id for update;
  if request_row.id is null or not exists (select 1 from public.workspace_members m where m.workspace_id=request_row.workspace_id and m.user_id=p_actor_id) then raise exception 'reanalysis not authorized'; end if;
  if request_row.status <> 'running' then return request_row; end if;
  update public.case_reanalysis_requests set status='failed', error_code=left(regexp_replace(coalesce(p_error_code,'reanalysis_failed'),'[^a-z0-9_]+','_','gi'),80), completed_at=now(), updated_at=now() where id=request_row.id returning * into request_row;
  return request_row;
end $$;

alter table public.case_intake_snapshots enable row level security;
alter table public.writing_style_profiles enable row level security;
alter table public.artifact_edit_signals enable row level security;
alter table public.clients enable row level security;
alter table public.case_reanalysis_requests enable row level security;
create policy case_intake_snapshots_member_select on public.case_intake_snapshots for select using (public.is_workspace_member(workspace_id));
create policy writing_style_profiles_member_select on public.writing_style_profiles for select using (public.is_workspace_member(workspace_id));
create policy artifact_edit_signals_member_select on public.artifact_edit_signals for select using (public.is_workspace_member(workspace_id));
create policy clients_member_select on public.clients for select using (public.is_workspace_member(workspace_id));
create policy case_reanalysis_member_select on public.case_reanalysis_requests for select using (public.is_workspace_member(workspace_id));

revoke all privileges on table public.case_intake_snapshots, public.writing_style_profiles, public.artifact_edit_signals, public.clients, public.case_reanalysis_requests from public, anon, authenticated, service_role;
grant select on table public.case_intake_snapshots, public.writing_style_profiles, public.artifact_edit_signals, public.clients, public.case_reanalysis_requests to authenticated, service_role;
revoke all on function public.case_source_state_hash(uuid), public.enqueue_case_reanalysis(uuid,uuid,text,text,integer,text), public.start_case_reanalysis(uuid,uuid), public.complete_case_reanalysis(uuid,uuid,integer,jsonb), public.fail_case_reanalysis(uuid,uuid,text), public.record_case_intake_snapshot(uuid,uuid,jsonb,text), public.create_artifact_edit_signal(uuid,uuid,integer,integer,text,text,jsonb), public.resolve_artifact_edit_signal(uuid,uuid,text,jsonb), public.create_client(uuid,text,text,text,jsonb), public.update_client(uuid,text,text,text,jsonb,text), public.archive_client(uuid), public.link_case_client(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.case_source_state_hash(uuid) to authenticated, service_role;
grant execute on function public.enqueue_case_reanalysis(uuid,uuid,text,text,integer,text), public.start_case_reanalysis(uuid,uuid), public.complete_case_reanalysis(uuid,uuid,integer,jsonb), public.fail_case_reanalysis(uuid,uuid,text), public.record_case_intake_snapshot(uuid,uuid,jsonb,text), public.create_artifact_edit_signal(uuid,uuid,integer,integer,text,text,jsonb), public.resolve_artifact_edit_signal(uuid,uuid,text,jsonb), public.create_client(uuid,text,text,text,jsonb), public.update_client(uuid,text,text,text,jsonb,text), public.archive_client(uuid), public.link_case_client(uuid,uuid) to authenticated, service_role;
