-- Solo Company OS initial schema. Apply to a dedicated Supabase project.
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "supabase_vault" with schema vault;

create type public.case_status as enum (
  'draft', 'working', 'awaiting_approval', 'approved', 'action_pending',
  'outcome_pending', 'completed', 'blocked', 'failed', 'cancelled'
);
create type public.module_key as enum ('growth', 'operations', 'intelligence');
create type public.action_type as enum ('gmail.create_draft');
create type public.member_role as enum ('owner', 'member', 'admin');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.action_status as enum ('pending', 'executing', 'executed', 'failed', 'cancelled');
create type public.learning_disposition as enum ('keep', 'adapt', 'discard');
create type public.execution_status as enum ('started', 'succeeded', 'failed', 'timed_out');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  locale text not null default 'en' check (locale in ('en', 'zh-Hant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  timezone text not null default 'Asia/Hong_Kong',
  default_locale text not null default 'en' check (default_locale in ('en', 'zh-Hant')),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  role public.member_role not null default 'member',
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create table public.pilot_applications (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 320),
  name text not null check (char_length(name) between 1 and 160),
  company text,
  role text,
  goals text not null check (char_length(goals) between 1 and 10000),
  locale text not null default 'en' check (locale in ('en', 'zh-Hant')),
  website text,
  metadata_hash text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'invited', 'declined')),
  created_at timestamptz not null default now()
);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  module public.module_key not null,
  template_key public.module_key not null,
  template_version integer not null check (template_version > 0),
  title text not null check (char_length(title) between 1 and 200),
  brief text not null check (char_length(brief) between 1 and 20000),
  status public.case_status not null default 'draft',
  current_revision integer not null default 0 check (current_revision >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (template_key = module)
);

create table public.case_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  revision integer not null check (revision > 0),
  kind text not null default 'synthesis',
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  template_key public.module_key not null,
  template_version integer not null check (template_version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (case_id, revision)
);

create table public.case_audience_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  artifact_revision integer not null,
  preset text not null check (preset in ('self', 'client', 'public', 'custom')),
  audience_profile jsonb not null,
  title text not null,
  summary text not null,
  body text not null,
  core_hash text not null check (core_hash ~ '^[a-f0-9]{64}$'),
  stale boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (case_id, artifact_revision, preset)
);

create table public.case_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  artifact_revision integer not null,
  action_type public.action_type not null,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null,
  status public.action_status not null default 'pending',
  provider_reference text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create table public.case_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  artifact_revision integer not null,
  artifact_hash text not null check (artifact_hash ~ '^[a-f0-9]{64}$'),
  action_payload_hash text check (action_payload_hash ~ '^[a-f0-9]{64}$'),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.case_outcomes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  expected_result text not null check (char_length(expected_result) between 0 and 20000),
  actual_result text not null check (char_length(actual_result) between 1 and 20000),
  evidence text not null check (char_length(evidence) between 0 and 20000),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  what_worked text not null default '',
  what_failed text not null default '',
  blockers text not null default '',
  next_action text not null check (char_length(next_action) between 1 and 2000),
  improvements text not null default '',
  other_angles text not null default '',
  follow_up_date date,
  learning_disposition public.learning_disposition not null,
  learning_note text,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  unique (case_id)
);

create table public.source_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  source_kind text not null default 'private_upload' check (source_kind in ('private_upload', 'url', 'pasted')),
  storage_path text,
  source_url text,
  filename text not null check (char_length(filename) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'processing', 'extracted', 'failed')),
  extracted_text text,
  extraction_error_code text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (
    (source_kind = 'private_upload' and storage_path is not null and source_url is null)
    or (source_kind = 'url' and source_url is not null and storage_path is null)
    or (source_kind = 'pasted' and storage_path is null and source_url is null)
  )
);

create table public.execution_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  provider text not null default 'openai',
  model text not null,
  status public.execution_status not null default 'started',
  response_id text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  estimated_cost_usd numeric(12,6) not null default 0 check (estimated_cost_usd >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid not null references auth.users(id)
);

create table public.learning_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  disposition public.learning_disposition not null,
  note text not null,
  tags text[] not null default '{}',
  search_document tsvector not null default ''::tsvector,
  approved_for_reuse boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.refresh_learning_search_document()
returns trigger language plpgsql set search_path = public as $$
begin
  new.search_document := to_tsvector('simple', coalesce(new.note, '') || ' ' || array_to_string(new.tags, ' '));
  return new;
end $$;

create trigger learning_records_search_document
before insert or update of note, tags on public.learning_records
for each row execute function public.refresh_learning_search_document();

create table public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider = 'google'),
  provider_account_id text not null,
  secret_ref uuid not null,
  scopes text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_account_id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.usage_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  units integer not null check (units > 0),
  provider text not null default 'openai',
  model text not null default 'unknown',
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  estimated_cost_usd numeric(12,6) not null default 0 check (estimated_cost_usd >= 0),
  created_at timestamptz not null default now()
);

create table public.public_rate_limits (
  route_key text not null,
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (route_key, subject_hash, window_start)
);

-- Keep the tenant discriminator and parent case inseparable. This prevents a
-- member from attaching a row in their workspace to a guessed case UUID in a
-- different workspace, even if a future policy is accidentally broadened.
alter table public.cases add constraint cases_workspace_id_id_key unique (workspace_id, id);
alter table public.case_artifacts add constraint artifacts_workspace_case_fk foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade;
alter table public.case_audience_variants add constraint variants_workspace_case_fk foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade;
alter table public.case_actions add constraint actions_workspace_case_fk foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade;
alter table public.case_approvals add constraint approvals_workspace_case_fk foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade;
alter table public.case_outcomes add constraint outcomes_workspace_case_fk foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade;
alter table public.source_items add constraint sources_workspace_case_fk foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade;
alter table public.execution_runs add constraint executions_workspace_case_fk foreign key (workspace_id, case_id) references public.cases(workspace_id, id) on delete cascade;

create index cases_workspace_updated_idx on public.cases(workspace_id, updated_at desc);
create index artifacts_case_revision_idx on public.case_artifacts(case_id, revision desc);
create index variants_case_revision_idx on public.case_audience_variants(case_id, artifact_revision desc);
create index audit_workspace_created_idx on public.audit_events(workspace_id, created_at desc);
create index invitations_email_idx on public.invitations(lower(email), status);
create index source_items_case_created_idx on public.source_items(case_id, created_at);
create index execution_runs_case_started_idx on public.execution_runs(case_id, started_at desc);
create index usage_workspace_created_idx on public.usage_events(workspace_id, created_at desc);
create index learning_records_search_idx on public.learning_records using gin(search_document);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = target_workspace and m.user_id = auth.uid());
$$;

create or replace function public.is_workspace_admin(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = target_workspace and m.user_id = auth.uid() and m.role in ('owner', 'admin'));
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create or replace function public.create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, display_name, locale)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), 'en')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger auth_user_creates_profile after insert on auth.users for each row execute function public.create_profile_for_auth_user();
insert into public.profiles(id, email, display_name, locale)
  select id, email, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'), 'en' from auth.users
on conflict (id) do nothing;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger cases_touch_updated_at before update on public.cases for each row execute function public.touch_updated_at();
create trigger oauth_connections_touch_updated_at before update on public.oauth_connections for each row execute function public.touch_updated_at();

create or replace function public.invalidate_approvals_on_new_artifact() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.case_approvals set revoked_at = now() where case_id = new.case_id and artifact_revision < new.revision and revoked_at is null;
  update public.case_audience_variants set stale = true where case_id = new.case_id and artifact_revision < new.revision and stale = false;
  return new;
end $$;
create trigger artifact_invalidates_approvals after insert on public.case_artifacts for each row execute function public.invalidate_approvals_on_new_artifact();

-- Approval can only be consumed when both hashes still match the current artifact/action.
create or replace function public.approve_case_action(
  p_case_id uuid, p_artifact_revision integer, p_artifact_hash text, p_action_payload_hash text
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid;
begin
  if not public.is_workspace_member((select workspace_id from public.cases where id = p_case_id)) then raise exception 'not authorized'; end if;
  if (select status from public.cases where id = p_case_id) <> 'awaiting_approval' then raise exception 'case is not awaiting approval'; end if;
  if not exists (select 1 from public.case_artifacts where case_id = p_case_id and revision = p_artifact_revision and content_hash = p_artifact_hash) then raise exception 'stale artifact'; end if;
  if not exists (select 1 from public.case_actions where case_id = p_case_id and artifact_revision = p_artifact_revision and payload_hash = p_action_payload_hash and status = 'pending') then raise exception 'stale action'; end if;
  insert into public.case_approvals(workspace_id, case_id, artifact_revision, artifact_hash, action_payload_hash, approved_by)
    select workspace_id, id, p_artifact_revision, p_artifact_hash, p_action_payload_hash, auth.uid() from public.cases where id = p_case_id returning id into result_id;
  update public.cases set status = 'action_pending' where id = p_case_id;
  return result_id;
end $$;

create or replace function public.approve_case_artifact(
  p_case_id uuid, p_artifact_revision integer, p_artifact_hash text
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid;
declare case_workspace uuid;
begin
  select workspace_id into case_workspace from public.cases where id = p_case_id and module = 'intelligence' and status = 'awaiting_approval' for update;
  if case_workspace is null or not public.is_workspace_member(case_workspace) then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.case_artifacts where case_id = p_case_id and workspace_id = case_workspace and revision = p_artifact_revision and content_hash = p_artifact_hash) then raise exception 'stale artifact'; end if;
  if exists (select 1 from public.case_actions where case_id = p_case_id and workspace_id = case_workspace and artifact_revision = p_artifact_revision and status in ('pending', 'executing')) then raise exception 'action approval required'; end if;
  insert into public.case_approvals(workspace_id, case_id, artifact_revision, artifact_hash, action_payload_hash, approved_by)
    values (case_workspace, p_case_id, p_artifact_revision, p_artifact_hash, null, auth.uid()) returning id into result_id;
  update public.cases set status = 'outcome_pending' where id = p_case_id and workspace_id = case_workspace;
  return result_id;
end $$;

create or replace function public.reserve_workspace_ai_quota(
  p_workspace_id uuid,
  p_model text default 'unknown',
  p_estimated_cost_usd numeric default 0,
  p_units integer default 1
) returns bigint language plpgsql security definer set search_path = public as $$
declare day_calls integer;
declare month_calls integer;
declare month_cost numeric;
declare event_id bigint;
begin
  if not public.is_workspace_member(p_workspace_id) or p_units < 1 or p_estimated_cost_usd < 0 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  select coalesce(sum(units), 0) into day_calls from public.usage_events where workspace_id = p_workspace_id and created_at >= date_trunc('day', now());
  select coalesce(sum(units), 0) into month_calls from public.usage_events where workspace_id = p_workspace_id and created_at >= date_trunc('month', now());
  select coalesce(sum(estimated_cost_usd), 0) into month_cost from public.usage_events where workspace_id = p_workspace_id and created_at >= date_trunc('month', now());
  if day_calls + p_units > 10 or month_calls + p_units > 50 or month_cost + (p_estimated_cost_usd * p_units) > 5 then return null; end if;
  insert into public.usage_events(workspace_id, user_id, units, model, estimated_cost_usd)
    values (p_workspace_id, auth.uid(), p_units, left(coalesce(nullif(trim(p_model), ''), 'unknown'), 120), p_estimated_cost_usd * p_units)
    returning id into event_id;
  return event_id;
end $$;

create or replace function public.consume_public_rate_limit(
  p_route_key text, p_subject_hash text, p_max_requests integer default 5
) returns boolean language plpgsql security definer set search_path = public as $$
declare accepted_count integer;
declare bucket timestamptz := date_trunc('hour', now());
begin
  if p_route_key not in ('pilot_application', 'magic_link') or p_subject_hash !~ '^[a-f0-9]{64}$' or p_max_requests not between 1 and 100 then return false; end if;
  insert into public.public_rate_limits(route_key, subject_hash, window_start, request_count)
    values (p_route_key, p_subject_hash, bucket, 1)
  on conflict (route_key, subject_hash, window_start) do update
    set request_count = public.public_rate_limits.request_count + 1
    where public.public_rate_limits.request_count < p_max_requests
  returning request_count into accepted_count;
  return accepted_count is not null and accepted_count <= p_max_requests;
end $$;

create or replace function public.consume_workspace_quota(p_workspace_id uuid, p_units integer default 1)
returns boolean language plpgsql security invoker as $$
begin
  return public.reserve_workspace_ai_quota(p_workspace_id, 'unknown', 0, p_units) is not null;
end $$;

create or replace function public.complete_workspace_usage(
  p_usage_event_id bigint,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_actual_cost_usd numeric
) returns boolean language plpgsql security definer set search_path = public as $$
declare workspace_id_value uuid;
begin
  select workspace_id into workspace_id_value from public.usage_events where id = p_usage_event_id;
  if workspace_id_value is null or not public.is_workspace_member(workspace_id_value) then return false; end if;
  update public.usage_events
    set input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
        output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
        total_tokens = greatest(coalesce(p_total_tokens, 0), 0),
        estimated_cost_usd = greatest(coalesce(p_actual_cost_usd, estimated_cost_usd), 0)
    where id = p_usage_event_id and workspace_id = workspace_id_value;
  return found;
end $$;

create or replace function public.register_source_item(
  p_workspace_id uuid,
  p_case_id uuid,
  p_storage_path text,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_sha256 text
) returns uuid language plpgsql security definer set search_path = public as $$
declare source_id uuid;
declare case_workspace uuid;
begin
  select workspace_id into case_workspace from public.cases where id = p_case_id;
  if case_workspace is null or case_workspace <> p_workspace_id or not public.is_workspace_member(p_workspace_id) then raise exception 'not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_case_id::text, 0));
  if (select count(*) from public.source_items where case_id = p_case_id and source_kind = 'private_upload') >= 5 then raise exception 'source limit reached'; end if;
  if p_byte_size <= 0 or p_byte_size > 10485760 then raise exception 'source size limit exceeded'; end if;
  if p_mime_type not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown') then raise exception 'unsupported source type'; end if;
  insert into public.source_items(workspace_id, case_id, storage_path, filename, mime_type, byte_size, sha256, extraction_status, created_by)
    values (p_workspace_id, p_case_id, p_storage_path, left(p_filename, 255), p_mime_type, p_byte_size, p_sha256, 'processing', auth.uid()) returning id into source_id;
  return source_id;
end $$;

create or replace function public.update_source_extraction(
  p_source_id uuid, p_status text, p_extracted_text text, p_error_code text, p_sha256 text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare workspace_id_value uuid;
begin
  select workspace_id into workspace_id_value from public.source_items where id = p_source_id;
  if workspace_id_value is null or not public.is_workspace_member(workspace_id_value) then return false; end if;
  if p_status not in ('extracted', 'failed') then raise exception 'invalid extraction status'; end if;
  update public.source_items set extraction_status = p_status, extracted_text = case when p_status = 'extracted' then left(coalesce(p_extracted_text, ''), 100000) else null end, extraction_error_code = case when p_status = 'failed' then left(p_error_code, 120) else null end, sha256 = coalesce(p_sha256, sha256) where id = p_source_id;
  return found;
end $$;

create or replace function public.storage_source_object_is_valid(p_object_name text, p_metadata jsonb)
returns boolean language sql immutable as $$
  select p_object_name ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,280}$'
    and (p_metadata->>'size') ~ '^[0-9]+$'
    and (p_metadata->>'size')::bigint between 1 and 10485760;
$$;

-- Vault stores OAuth refresh tokens; callers receive only a reference UUID.
create or replace function public.store_oauth_secret(p_workspace_id uuid, p_name text, p_secret text)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare secret_id uuid;
begin
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then raise exception 'workspace unavailable'; end if;
  select vault.create_secret(p_secret, p_name, 'Solo Company OS OAuth secret') into secret_id;
  return secret_id;
end $$;

create or replace function public.read_oauth_secret(p_workspace_id uuid, p_secret_id uuid)
returns text language plpgsql security definer set search_path = public, vault as $$
declare secret_value text;
begin
  if not exists (select 1 from public.oauth_connections where workspace_id = p_workspace_id and secret_ref = p_secret_id) then raise exception 'secret unavailable'; end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id = p_secret_id;
  return secret_value;
end $$;

create or replace function public.update_oauth_secret(p_workspace_id uuid, p_secret_id uuid, p_secret text)
returns boolean language plpgsql security definer set search_path = public, vault as $$
begin
  if not exists (select 1 from public.oauth_connections where workspace_id = p_workspace_id and secret_ref = p_secret_id) then raise exception 'secret unavailable'; end if;
  perform vault.update_secret(p_secret_id, p_secret, null, null);
  return true;
end $$;

create or replace function public.delete_oauth_secret(p_workspace_id uuid, p_secret_id uuid)
returns boolean language plpgsql security definer set search_path = public, vault as $$
begin
  delete from public.oauth_connections where workspace_id = p_workspace_id and secret_ref = p_secret_id;
  if not found then return false; end if;
  delete from vault.secrets where id = p_secret_id;
  return true;
end $$;

create or replace function public.accept_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare invitation public.invitations;
declare new_workspace uuid;
begin
  select * into invitation from public.invitations where id = p_invitation_id and lower(email) = lower((select email from auth.users where id = auth.uid())) and status = 'pending' and expires_at > now() for update;
  if invitation.id is null then raise exception 'invitation unavailable'; end if;
  insert into public.workspace_members(workspace_id, user_id, role) values (invitation.workspace_id, auth.uid(), invitation.role) on conflict (workspace_id, user_id) do update set role = excluded.role;
  update public.invitations set status = 'accepted', accepted_at = now() where id = p_invitation_id;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (invitation.workspace_id, auth.uid(), 'invite_accepted', 'invitation', invitation.id, '{}');
  return invitation.workspace_id;
end $$;

create or replace function public.accept_pending_invitations_for_current_user()
returns integer language plpgsql security definer set search_path = public as $$
declare current_email text;
declare accepted_count integer := 0;
declare invitation public.invitations;
begin
  select email into current_email from auth.users where id = auth.uid();
  for invitation in select * from public.invitations where lower(email) = lower(current_email) and status = 'pending' and expires_at > now() loop
    insert into public.workspace_members(workspace_id, user_id, role) values (invitation.workspace_id, auth.uid(), invitation.role) on conflict (workspace_id, user_id) do update set role = excluded.role;
    update public.invitations set status = 'accepted', accepted_at = now() where id = invitation.id;
    insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
      values (invitation.workspace_id, auth.uid(), 'invite_accepted', 'invitation', invitation.id, '{}');
    accepted_count := accepted_count + 1;
  end loop;
  return accepted_count;
end $$;

create or replace function public.revoke_case_approvals(p_case_id uuid, p_revision integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_workspace_member((select workspace_id from public.cases where id = p_case_id)) then raise exception 'not authorized'; end if;
  update public.case_approvals set revoked_at = now() where case_id = p_case_id and artifact_revision < p_revision and revoked_at is null and public.is_workspace_member(workspace_id);
end $$;

create or replace function public.claim_case_action(p_action_id uuid, p_idempotency_key text)
returns boolean language plpgsql security definer set search_path = public as $$
declare action_row public.case_actions;
begin
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null or action_row.status <> 'pending' or action_row.idempotency_key <> p_idempotency_key then return false; end if;
  if not public.is_workspace_member(action_row.workspace_id) then return false; end if;
  if (select status from public.cases where id = action_row.case_id and workspace_id = action_row.workspace_id) <> 'action_pending' then return false; end if;
  if not exists (
    select 1
      from public.case_approvals a
      join public.case_artifacts r on r.case_id = a.case_id and r.workspace_id = a.workspace_id and r.revision = a.artifact_revision and r.content_hash = a.artifact_hash
     where a.case_id = action_row.case_id
       and a.workspace_id = action_row.workspace_id
       and a.artifact_revision = action_row.artifact_revision
       and a.action_payload_hash = action_row.payload_hash
       and a.revoked_at is null
  ) then return false; end if;
  update public.case_actions set status = 'executing' where id = p_action_id and status = 'pending';
  return found;
end $$;

create or replace function public.mark_case_action_executed(p_action_id uuid, p_provider_reference text)
returns boolean language plpgsql security definer set search_path = public as $$
declare action_row public.case_actions;
begin
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null or action_row.status <> 'executing' then return false; end if;
  if not public.is_workspace_member(action_row.workspace_id) then return false; end if;
  if (select status from public.cases where id = action_row.case_id) <> 'action_pending' then return false; end if;
  if not exists (select 1 from public.case_approvals a where a.case_id = action_row.case_id and a.artifact_revision = action_row.artifact_revision and a.action_payload_hash = action_row.payload_hash and a.revoked_at is null) then return false; end if;
  update public.case_actions set status = 'executed', provider_reference = p_provider_reference, executed_at = now() where id = p_action_id;
  update public.cases set status = 'outcome_pending' where id = action_row.case_id and status = 'action_pending';
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (action_row.workspace_id, auth.uid(), 'action_executed', 'case_action', action_row.id, jsonb_build_object('provider', 'gmail'));
  return true;
end $$;

create or replace function public.record_case_outcome(
  p_case_id uuid,
  p_expected_result text,
  p_actual_result text,
  p_evidence text,
  p_confidence text,
  p_what_worked text,
  p_what_failed text,
  p_blockers text,
  p_next_action text,
  p_improvements text,
  p_other_angles text,
  p_follow_up_date date,
  p_learning_disposition public.learning_disposition,
  p_learning_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare case_row public.cases;
declare result_id uuid;
begin
  select * into case_row from public.cases where id = p_case_id for update;
  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) or case_row.status <> 'outcome_pending' then raise exception 'outcome not pending'; end if;
  if char_length(trim(coalesce(p_actual_result, ''))) = 0 or char_length(trim(coalesce(p_next_action, ''))) = 0 then raise exception 'outcome requires next action'; end if;
  if p_confidence not in ('low', 'medium', 'high') then raise exception 'invalid confidence'; end if;
  insert into public.case_outcomes(workspace_id, case_id, expected_result, actual_result, evidence, confidence, what_worked, what_failed, blockers, next_action, improvements, other_angles, follow_up_date, learning_disposition, learning_note, reviewed_by)
    values (case_row.workspace_id, case_row.id, coalesce(p_expected_result, ''), p_actual_result, coalesce(p_evidence, ''), p_confidence, coalesce(p_what_worked, ''), coalesce(p_what_failed, ''), coalesce(p_blockers, ''), p_next_action, coalesce(p_improvements, ''), coalesce(p_other_angles, ''), p_follow_up_date, p_learning_disposition, p_learning_note, auth.uid()) returning id into result_id;
  insert into public.learning_records(workspace_id, case_id, disposition, note, tags, created_by)
    values (case_row.workspace_id, case_row.id, p_learning_disposition, coalesce(nullif(trim(p_learning_note), ''), p_actual_result), array[case_row.module::text], auth.uid());
  update public.cases set status = 'completed' where id = p_case_id;
  return result_id;
end $$;

create or replace function public.confirm_learning_for_reuse(p_learning_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare learning_workspace uuid;
begin
  select workspace_id into learning_workspace from public.learning_records where id = p_learning_id and disposition <> 'discard' for update;
  if learning_workspace is null or not public.is_workspace_member(learning_workspace) then return false; end if;
  update public.learning_records set approved_for_reuse = true where id = p_learning_id and workspace_id = learning_workspace;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (learning_workspace, auth.uid(), 'learning.confirmed', 'learning_record', p_learning_id, '{}');
  return found;
end $$;

-- Audit is append-only. No client may update/delete audit history.
create or replace function public.reject_audit_mutation() returns trigger language plpgsql as $$ begin raise exception 'audit events are append-only'; end $$;
create trigger audit_no_update before update or delete on public.audit_events for each row execute function public.reject_audit_mutation();

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations enable row level security;
alter table public.pilot_applications enable row level security;
alter table public.cases enable row level security;
alter table public.case_artifacts enable row level security;
alter table public.case_audience_variants enable row level security;
alter table public.case_actions enable row level security;
alter table public.case_approvals enable row level security;
alter table public.case_outcomes enable row level security;
alter table public.learning_records enable row level security;
alter table public.source_items enable row level security;
alter table public.execution_runs enable row level security;
alter table public.oauth_connections enable row level security;
alter table public.audit_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.public_rate_limits enable row level security;

create policy workspaces_member_select on public.workspaces for select using (public.is_workspace_member(id));
create policy profiles_self_select on public.profiles for select using (id = auth.uid());
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy members_self_or_admin_select on public.workspace_members for select using (user_id = auth.uid() or public.is_workspace_admin(workspace_id));
create policy invitations_admin_select on public.invitations for select using (public.is_workspace_admin(workspace_id));
create policy cases_member_select on public.cases for select using (public.is_workspace_member(workspace_id));
create policy artifacts_member_select on public.case_artifacts for select using (public.is_workspace_member(workspace_id));
create policy variants_member_select on public.case_audience_variants for select using (public.is_workspace_member(workspace_id));
create policy actions_member_select on public.case_actions for select using (public.is_workspace_member(workspace_id));
create policy approvals_member_select on public.case_approvals for select using (public.is_workspace_member(workspace_id));
create policy outcomes_member_select on public.case_outcomes for select using (public.is_workspace_member(workspace_id));
create policy learning_member_select on public.learning_records for select using (public.is_workspace_member(workspace_id));
create policy source_items_member_select on public.source_items for select using (public.is_workspace_member(workspace_id));
create policy execution_runs_member_select on public.execution_runs for select using (public.is_workspace_member(workspace_id));
create policy oauth_member_select on public.oauth_connections for select using (public.is_workspace_member(workspace_id));
create policy audit_member_select on public.audit_events for select using (workspace_id is not null and public.is_workspace_member(workspace_id));
create policy usage_member_select on public.usage_events for select using (public.is_workspace_member(workspace_id));

-- Anonymous visitors can submit a bounded pilot application, never read/update it.
create policy pilot_anon_insert on public.pilot_applications for insert to anon, authenticated with check (char_length(email) between 3 and 320 and char_length(goals) between 1 and 10000);

insert into storage.buckets (id, name, public) values ('source-documents', 'source-documents', false) on conflict (id) do nothing;
create policy source_documents_member_read on storage.objects for select using (bucket_id = 'source-documents' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy source_documents_member_write on storage.objects for insert with check (bucket_id = 'source-documents' and public.is_workspace_member((storage.foldername(name))[1]::uuid) and public.storage_source_object_is_valid(name, metadata));
create policy source_documents_member_delete on storage.objects for delete using (bucket_id = 'source-documents' and public.is_workspace_admin((storage.foldername(name))[1]::uuid));

-- Function execution is an API surface. Vault plaintext is service-role only;
-- state-changing tenant RPCs require an authenticated session and validate
-- membership again internally.
revoke all on function public.store_oauth_secret(uuid, text, text) from public, anon, authenticated;
revoke all on function public.read_oauth_secret(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_oauth_secret(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_oauth_secret(uuid, uuid) from public, anon, authenticated;
grant execute on function public.store_oauth_secret(uuid, text, text) to service_role;
grant execute on function public.read_oauth_secret(uuid, uuid) to service_role;
grant execute on function public.update_oauth_secret(uuid, uuid, text) to service_role;
grant execute on function public.delete_oauth_secret(uuid, uuid) to service_role;

revoke all on function public.reserve_workspace_ai_quota(uuid, text, numeric, integer) from public, anon;
revoke all on function public.consume_public_rate_limit(text, text, integer) from public, anon, authenticated;
revoke all on function public.complete_workspace_usage(bigint, integer, integer, integer, numeric) from public, anon;
revoke all on function public.approve_case_action(uuid, integer, text, text) from public, anon;
revoke all on function public.approve_case_artifact(uuid, integer, text) from public, anon;
revoke all on function public.register_source_item(uuid, uuid, text, text, text, bigint, text) from public, anon;
revoke all on function public.update_source_extraction(uuid, text, text, text, text) from public, anon;
revoke all on function public.accept_invitation(uuid) from public, anon;
revoke all on function public.accept_pending_invitations_for_current_user() from public, anon;
revoke all on function public.revoke_case_approvals(uuid, integer) from public, anon;
revoke all on function public.claim_case_action(uuid, text) from public, anon;
revoke all on function public.mark_case_action_executed(uuid, text) from public, anon;
revoke all on function public.record_case_outcome(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text) from public, anon;
revoke all on function public.confirm_learning_for_reuse(uuid) from public, anon;

grant execute on function public.reserve_workspace_ai_quota(uuid, text, numeric, integer) to authenticated;
grant execute on function public.consume_public_rate_limit(text, text, integer) to service_role;
grant execute on function public.complete_workspace_usage(bigint, integer, integer, integer, numeric) to authenticated;
grant execute on function public.approve_case_action(uuid, integer, text, text) to authenticated;
grant execute on function public.approve_case_artifact(uuid, integer, text) to authenticated;
grant execute on function public.register_source_item(uuid, uuid, text, text, text, bigint, text) to authenticated;
grant execute on function public.update_source_extraction(uuid, text, text, text, text) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.accept_pending_invitations_for_current_user() to authenticated;
grant execute on function public.revoke_case_approvals(uuid, integer) to authenticated;
grant execute on function public.claim_case_action(uuid, text) to authenticated;
grant execute on function public.mark_case_action_executed(uuid, text) to authenticated;
grant execute on function public.record_case_outcome(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text) to authenticated;
grant execute on function public.confirm_learning_for_reuse(uuid) to authenticated;
