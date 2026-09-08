-- Per-user Google OAuth connections and draft execution binding.
-- Existing rows cannot be proven to contain a Google OIDC subject: their
-- provider_account_id was historically a Supabase user UUID.  They are kept
-- for recovery, but explicitly require reauthorisation.

do $$
begin
  create type public.oauth_connection_status as enum ('active', 'reauthorization_required', 'disconnecting');
exception
  when duplicate_object then null;
end $$;

alter table public.oauth_connections
  add column if not exists owner_user_id uuid,
  add column if not exists provider_account_email text,
  add column if not exists mailbox_email text,
  add column if not exists provider_email_verified boolean not null default false,
  add column if not exists status public.oauth_connection_status not null default 'reauthorization_required',
  add column if not exists token_version integer not null default 1,
  add column if not exists refresh_lease_token uuid,
  add column if not exists refresh_lease_expires_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_refreshed_at timestamptz,
  add column if not exists last_used_at timestamptz;

update public.oauth_connections
   set owner_user_id = created_by,
       status = 'reauthorization_required',
       provider_email_verified = false
 where owner_user_id is null;

alter table public.oauth_connections
  alter column owner_user_id set not null,
  add constraint oauth_connections_owner_fk foreign key (owner_user_id) references auth.users(id) on delete cascade,
  add constraint oauth_connections_token_version_positive check (token_version > 0),
  add constraint oauth_connections_email_lengths check (
    char_length(coalesce(provider_account_email, '')) <= 320
    and char_length(coalesce(mailbox_email, '')) <= 320
    and char_length(coalesce(last_error_code, '')) <= 120
  );

-- The initial migration's uniqueness constraint used the legacy provider ID.
-- Keep the same invariant for verified Google subjects, and add the owner
-- boundary required for one connection per workspace/user.
alter table public.oauth_connections
  drop constraint if exists oauth_connections_workspace_id_provider_provider_account_id_key;
create unique index if not exists oauth_connections_workspace_provider_sub_unique
  on public.oauth_connections(workspace_id, provider, provider_account_id);

-- Never silently deduplicate legacy rows.  A duplicate owner means the
-- migration cannot safely choose which encrypted token is authoritative.
do $$
declare duplicate_owner_groups integer;
begin
  select count(*) into duplicate_owner_groups
    from (
      select workspace_id, provider, coalesce(owner_user_id, created_by) as owner_user_id
        from public.oauth_connections
       group by workspace_id, provider, coalesce(owner_user_id, created_by)
      having count(*) > 1
    ) conflicts;
  if duplicate_owner_groups > 0 then
    raise exception 'oauth connection owner conflict: % duplicate owner groups', duplicate_owner_groups using errcode = 'P0001';
  end if;
end $$;

create unique index if not exists oauth_connections_workspace_owner_unique
  on public.oauth_connections(workspace_id, provider, owner_user_id);
create index if not exists oauth_connections_owner_status_idx
  on public.oauth_connections(owner_user_id, workspace_id, status);

drop policy if exists oauth_member_select on public.oauth_connections;
create policy oauth_owner_member_select on public.oauth_connections
  for select using (
    owner_user_id = auth.uid()
    and public.is_workspace_member(workspace_id)
  );

alter table public.case_actions
  add column if not exists execution_actor_id uuid references auth.users(id),
  add column if not exists execution_connection_id uuid references public.oauth_connections(id) on delete set null,
  add column if not exists execution_connection_version integer,
  add column if not exists execution_connection_email text;

alter table public.case_actions
  add constraint case_actions_execution_connection_snapshot check (
    status <> 'executing' or (
      execution_actor_id is not null
      and execution_connection_id is not null
      and execution_connection_version is not null
      and execution_connection_email is not null
    )
  ) not valid;

create index if not exists case_actions_execution_connection_idx
  on public.case_actions(execution_connection_id, status);

-- Connection lifecycle RPCs are service-role-only.  Each verifies that the
-- supplied owner is actually a member of the supplied workspace even though
-- the service role does not carry a browser auth.uid().
create or replace function public.connect_google_oauth(
  p_workspace_id uuid,
  p_owner_user_id uuid,
  p_provider_account_id text,
  p_provider_account_email text,
  p_mailbox_email text,
  p_provider_email_verified boolean,
  p_scopes text[],
  p_secret text
) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare
  connection_row public.oauth_connections;
  secret_id uuid;
  required_scopes text[] := array['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'];
begin
  if not exists (
    select 1 from public.workspace_members
     where workspace_id = p_workspace_id and user_id = p_owner_user_id
  ) then raise exception 'workspace owner unavailable'; end if;
  if p_provider_account_id is null or char_length(trim(p_provider_account_id)) not between 1 and 256 then raise exception 'Google subject unavailable'; end if;
  if p_provider_account_email is null or p_mailbox_email is null or lower(trim(p_provider_account_email)) <> lower(trim(p_mailbox_email)) then raise exception 'Google mailbox mismatch'; end if;
  if coalesce(p_provider_email_verified, false) is not true then raise exception 'Google email is not verified'; end if;
  if p_scopes is null or cardinality(p_scopes) <> cardinality(required_scopes) or not (p_scopes @> required_scopes and required_scopes @> p_scopes) then raise exception 'Google scopes are incomplete'; end if;
  if p_secret is null or char_length(p_secret) not between 1 and 30000 then raise exception 'Google secret unavailable'; end if;

  select * into connection_row
    from public.oauth_connections
   where workspace_id = p_workspace_id and provider = 'google' and owner_user_id = p_owner_user_id
   for update;

  if connection_row.id is null then
    select vault.create_secret(p_secret, 'google-' || p_workspace_id::text || '-' || gen_random_uuid()::text, 'Solo Company OS OAuth secret') into secret_id;
    insert into public.oauth_connections(
      workspace_id, provider, provider_account_id, secret_ref, scopes, created_by,
      owner_user_id, provider_account_email, mailbox_email, provider_email_verified,
      status, token_version, last_error_code, last_error_at, last_refreshed_at, last_used_at
    ) values (
      p_workspace_id, 'google', trim(p_provider_account_id), secret_id, p_scopes, p_owner_user_id,
      p_owner_user_id, lower(trim(p_provider_account_email)), lower(trim(p_mailbox_email)), true,
      'active', 1, null, null, now(), null
    ) returning * into connection_row;
  else
    if exists (select 1 from public.case_actions where execution_connection_id = connection_row.id and status = 'executing') then
      raise exception 'connection has executing action';
    end if;
    perform vault.update_secret(connection_row.secret_ref, p_secret, null, null);
    update public.oauth_connections
       set provider_account_id = trim(p_provider_account_id),
           scopes = p_scopes,
           provider_account_email = lower(trim(p_provider_account_email)),
           mailbox_email = lower(trim(p_mailbox_email)),
           provider_email_verified = true,
           status = 'active',
           token_version = greatest(connection_row.token_version + 1, 1),
           refresh_lease_token = null,
           refresh_lease_expires_at = null,
           last_error_code = null,
           last_error_at = null,
           last_refreshed_at = now(),
           updated_at = now()
     where id = connection_row.id
     returning * into connection_row;
  end if;

  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (p_workspace_id, p_owner_user_id, 'google.connection_connected', 'oauth_connection', connection_row.id,
      jsonb_build_object('provider', 'google', 'status', 'active'));
  return connection_row.id;
end $$;

create or replace function public.read_oauth_connection_secret(
  p_workspace_id uuid, p_owner_user_id uuid, p_connection_id uuid
) returns text
language plpgsql security definer set search_path = public, vault as $$
declare secret_value text;
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_owner_user_id) then raise exception 'workspace owner unavailable'; end if;
  select ds.decrypted_secret into secret_value
    from public.oauth_connections c
    join vault.decrypted_secrets ds on ds.id = c.secret_ref
   where c.id = p_connection_id and c.workspace_id = p_workspace_id and c.owner_user_id = p_owner_user_id;
  if secret_value is null then raise exception 'secret unavailable'; end if;
  return secret_value;
end $$;

create or replace function public.begin_oauth_connection_refresh(
  p_workspace_id uuid, p_owner_user_id uuid, p_connection_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, vault as $$
declare
  connection_row public.oauth_connections;
  secret_value text;
  lease_token uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_owner_user_id) then return null; end if;
  select * into connection_row from public.oauth_connections
   where id = p_connection_id and workspace_id = p_workspace_id and owner_user_id = p_owner_user_id
   for update;
  if connection_row.id is null or connection_row.status <> 'active' then return null; end if;
  if connection_row.refresh_lease_token is not null and connection_row.refresh_lease_expires_at > now() then return null; end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id = connection_row.secret_ref;
  if secret_value is null then return null; end if;
  update public.oauth_connections
     set refresh_lease_token = lease_token,
         refresh_lease_expires_at = now() + interval '2 minutes',
         updated_at = now()
   where id = connection_row.id;
  return jsonb_build_object('lease_token', lease_token, 'token_version', connection_row.token_version, 'secret', secret_value);
end $$;

create or replace function public.finalize_oauth_connection_refresh(
  p_workspace_id uuid,
  p_owner_user_id uuid,
  p_connection_id uuid,
  p_lease_token uuid,
  p_expected_token_version integer,
  p_secret text
) returns boolean
language plpgsql security definer set search_path = public, vault as $$
declare connection_row public.oauth_connections;
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_owner_user_id) then return false; end if;
  select * into connection_row from public.oauth_connections
   where id = p_connection_id and workspace_id = p_workspace_id and owner_user_id = p_owner_user_id
   for update;
  if connection_row.id is null or connection_row.status <> 'active' or connection_row.refresh_lease_token is distinct from p_lease_token or connection_row.token_version is distinct from p_expected_token_version or connection_row.refresh_lease_expires_at < now() then return false; end if;
  perform vault.update_secret(connection_row.secret_ref, p_secret, null, null);
  update public.oauth_connections
     set token_version = token_version + 1,
         refresh_lease_token = null,
         refresh_lease_expires_at = null,
         last_error_code = null,
         last_error_at = null,
         last_refreshed_at = now(),
         updated_at = now()
   where id = connection_row.id;
  return true;
end $$;

create or replace function public.fail_oauth_connection_refresh(
  p_workspace_id uuid,
  p_owner_user_id uuid,
  p_connection_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_reauthorization_required boolean default false
) returns boolean
language plpgsql security definer set search_path = public as $$
declare connection_row public.oauth_connections;
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_owner_user_id) then return false; end if;
  select * into connection_row from public.oauth_connections
   where id = p_connection_id and workspace_id = p_workspace_id and owner_user_id = p_owner_user_id
   for update;
  if connection_row.id is null or connection_row.refresh_lease_token is distinct from p_lease_token then return false; end if;
  update public.oauth_connections
     set status = case when coalesce(p_reauthorization_required, false) then 'reauthorization_required'::public.oauth_connection_status else status end,
         refresh_lease_token = null,
         refresh_lease_expires_at = null,
         last_error_code = left(coalesce(nullif(trim(p_error_code), ''), 'google_refresh_failed'), 120),
         last_error_at = now(),
         updated_at = now()
   where id = connection_row.id;
  return true;
end $$;

create or replace function public.begin_oauth_disconnect(
  p_workspace_id uuid, p_owner_user_id uuid, p_connection_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, vault as $$
declare
  connection_row public.oauth_connections;
  secret_value text;
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_owner_user_id) then return null; end if;
  select * into connection_row from public.oauth_connections
   where id = p_connection_id and workspace_id = p_workspace_id and owner_user_id = p_owner_user_id
   for update;
  if connection_row.id is null then return null; end if;
  if exists (select 1 from public.case_actions where execution_connection_id = connection_row.id and status = 'executing') then raise exception 'connection has executing action'; end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id = connection_row.secret_ref;
  if secret_value is null then return null; end if;
  update public.oauth_connections set status = 'disconnecting', refresh_lease_token = null, refresh_lease_expires_at = null, updated_at = now() where id = connection_row.id;
  return jsonb_build_object('connection_id', connection_row.id, 'secret', secret_value);
end $$;

create or replace function public.finish_oauth_disconnect(
  p_workspace_id uuid, p_owner_user_id uuid, p_connection_id uuid
) returns boolean
language plpgsql security definer set search_path = public, vault as $$
declare connection_row public.oauth_connections;
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_owner_user_id) then return false; end if;
  select * into connection_row from public.oauth_connections
   where id = p_connection_id and workspace_id = p_workspace_id and owner_user_id = p_owner_user_id and status = 'disconnecting'
   for update;
  if connection_row.id is null then return false; end if;
  delete from public.oauth_connections where id = connection_row.id;
  delete from vault.secrets where id = connection_row.secret_ref;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (p_workspace_id, p_owner_user_id, 'google.connection_disconnected', 'oauth_connection', connection_row.id, jsonb_build_object('provider', 'google'));
  return true;
end $$;

create or replace function public.fail_oauth_disconnect(
  p_workspace_id uuid, p_owner_user_id uuid, p_connection_id uuid, p_reauthorization_required boolean default false, p_error_code text default 'google_revoke_failed'
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_owner_user_id) then return false; end if;
  update public.oauth_connections
     set status = case when coalesce(p_reauthorization_required, false) then 'reauthorization_required'::public.oauth_connection_status else 'active'::public.oauth_connection_status end,
         last_error_code = left(coalesce(nullif(trim(p_error_code), ''), 'google_revoke_failed'), 120),
         last_error_at = now(),
         updated_at = now()
   where id = p_connection_id and workspace_id = p_workspace_id and owner_user_id = p_owner_user_id and status = 'disconnecting';
  return found;
end $$;

-- Lock order is case -> connection -> action.  Approval/revision mutations
-- lock the case and action row before changing an approval, so a claim cannot
-- race a revoke or edit after it has captured the exact approval.
create or replace function public.claim_case_action_attempt(
  p_action_id uuid,
  p_idempotency_key text,
  p_provider_message_id text,
  p_connection_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  case_row public.cases;
  action_row public.case_actions;
  connection_row public.oauth_connections;
  approval_id uuid;
  attempt_id uuid := gen_random_uuid();
begin
  select c.* into case_row
    from public.cases c
   where c.id = (select case_id from public.case_actions where id = p_action_id)
   for update;
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null then return null; end if;
  if case_row.id is null or case_row.id <> action_row.case_id or case_row.workspace_id <> action_row.workspace_id then return null; end if;
  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) then return null; end if;
  if action_row.status <> 'pending' or action_row.idempotency_key <> p_idempotency_key then return null; end if;
  if p_provider_message_id is null or p_provider_message_id !~ '^<solo-os-[a-f0-9]{64}@actions\.solo-company-os\.invalid>$' then return null; end if;
  if case_row.status <> 'action_pending' then return null; end if;
  select * into connection_row from public.oauth_connections where id = p_connection_id and workspace_id = action_row.workspace_id and owner_user_id = auth.uid() for update;
  if connection_row.id is null or connection_row.status <> 'active' then return null; end if;
  select a.id into approval_id
    from public.case_approvals a
    join public.case_artifacts r on r.case_id = a.case_id and r.workspace_id = a.workspace_id and r.revision = a.artifact_revision and r.content_hash = a.artifact_hash
   where a.case_id = action_row.case_id and a.workspace_id = action_row.workspace_id
     and a.artifact_revision = action_row.artifact_revision and a.action_payload_hash = action_row.payload_hash
     and a.revoked_at is null
   order by a.approved_at desc limit 1;
  if approval_id is null then return null; end if;
  update public.case_actions
     set status = 'executing', execution_attempt_id = attempt_id, execution_approval_id = approval_id,
         execution_started_at = now(), provider_message_id = p_provider_message_id,
         reconciliation_checked_at = null, execution_actor_id = auth.uid(),
         execution_connection_id = connection_row.id, execution_connection_version = connection_row.token_version,
         execution_connection_email = connection_row.mailbox_email
   where id = p_action_id and status = 'pending';
  if not found then return null; end if;
  return attempt_id;
end $$;

create or replace function public.mark_case_action_executed_attempt(
  p_action_id uuid,
  p_execution_attempt_id uuid,
  p_provider_reference text,
  p_provider_message_id text,
  p_reconciled boolean default false
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  case_row public.cases;
  action_row public.case_actions;
  connection_row public.oauth_connections;
begin
  select c.* into case_row
    from public.cases c
   where c.id = (select case_id from public.case_actions where id = p_action_id)
   for update;
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null then return false; end if;
  if case_row.id is null or case_row.id <> action_row.case_id or case_row.workspace_id <> action_row.workspace_id or action_row.status <> 'executing' then return false; end if;
  if action_row.execution_attempt_id is distinct from p_execution_attempt_id or action_row.provider_message_id is distinct from p_provider_message_id then return false; end if;
  if action_row.execution_actor_id is distinct from auth.uid() then return false; end if;
  select * into connection_row from public.oauth_connections where id = action_row.execution_connection_id and workspace_id = action_row.workspace_id and owner_user_id = auth.uid() for update;
  if connection_row.id is null or connection_row.status <> 'active' or connection_row.mailbox_email is distinct from action_row.execution_connection_email then return false; end if;
  if char_length(coalesce(p_provider_reference, '')) < 1 or char_length(p_provider_reference) > 500 then return false; end if;
  if not exists (
    select 1 from public.case_approvals a
     join public.case_artifacts r on r.case_id = a.case_id and r.workspace_id = a.workspace_id and r.revision = a.artifact_revision and r.content_hash = a.artifact_hash
    where a.id = action_row.execution_approval_id and a.case_id = action_row.case_id and a.workspace_id = action_row.workspace_id
      and a.artifact_revision = action_row.artifact_revision and a.action_payload_hash = action_row.payload_hash and a.revoked_at is null
  ) then return false; end if;
  update public.case_actions
     set status = 'executed', provider_reference = p_provider_reference,
         reconciliation_checked_at = case when coalesce(p_reconciled, false) then now() else reconciliation_checked_at end,
         executed_at = now()
   where id = p_action_id;
  update public.oauth_connections set last_used_at = now(), updated_at = now() where id = connection_row.id;
  update public.cases set status = 'outcome_pending' where id = action_row.case_id and status = 'action_pending';
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (action_row.workspace_id, auth.uid(), 'action_executed', 'case_action', action_row.id, jsonb_build_object('provider', 'gmail', 'reconciled', coalesce(p_reconciled, false)));
  return true;
end $$;

create or replace function public.record_case_action_reconciliation_check(
  p_action_id uuid, p_execution_attempt_id uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare action_row public.case_actions;
begin
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null or action_row.status <> 'executing' or action_row.execution_attempt_id is distinct from p_execution_attempt_id then return false; end if;
  if action_row.execution_actor_id is distinct from auth.uid() then return false; end if;
  if not exists (select 1 from public.oauth_connections where id = action_row.execution_connection_id and workspace_id = action_row.workspace_id and owner_user_id = auth.uid() and status = 'active') then return false; end if;
  update public.case_actions set reconciliation_checked_at = now() where id = p_action_id;
  return true;
end $$;

-- Revoke/edit paths take the action lock before invalidating approvals.
create or replace function public.revoke_case_approvals(p_case_id uuid, p_revision integer)
returns void language plpgsql security definer set search_path = public as $$
declare case_row public.cases; current_action public.case_actions;
begin
  select * into case_row from public.cases where id = p_case_id for update;
  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) then raise exception 'not authorized'; end if;
  select * into current_action from public.case_actions where case_id = p_case_id and workspace_id = case_row.workspace_id and artifact_revision = p_revision order by created_at desc limit 1 for update;
  if current_action.status = 'executing' then raise exception 'action is already executing'; end if;
  update public.case_approvals set revoked_at = now() where case_id = p_case_id and workspace_id = case_row.workspace_id and artifact_revision < p_revision and revoked_at is null;
end $$;

-- The old three-argument claim is intentionally not executable by browser
-- sessions; callers must name the exact owned connection.
revoke all on function public.claim_case_action_attempt(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_case_action_attempt(uuid, text, text, uuid) from public, anon;
grant execute on function public.claim_case_action_attempt(uuid, text, text, uuid) to authenticated;
revoke all on function public.mark_case_action_executed_attempt(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.mark_case_action_executed_attempt(uuid, uuid, text, text, boolean) to authenticated;
revoke all on function public.record_case_action_reconciliation_check(uuid, uuid) from public, anon;
grant execute on function public.record_case_action_reconciliation_check(uuid, uuid) to authenticated;

revoke all on function public.connect_google_oauth(uuid, uuid, text, text, text, boolean, text[], text) from public, anon, authenticated;
revoke all on function public.read_oauth_connection_secret(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.begin_oauth_connection_refresh(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_oauth_connection_refresh(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.fail_oauth_connection_refresh(uuid, uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.begin_oauth_disconnect(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_oauth_disconnect(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_oauth_disconnect(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.connect_google_oauth(uuid, uuid, text, text, text, boolean, text[], text) to service_role;
grant execute on function public.read_oauth_connection_secret(uuid, uuid, uuid) to service_role;
grant execute on function public.begin_oauth_connection_refresh(uuid, uuid, uuid) to service_role;
grant execute on function public.finalize_oauth_connection_refresh(uuid, uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.fail_oauth_connection_refresh(uuid, uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function public.begin_oauth_disconnect(uuid, uuid, uuid) to service_role;
grant execute on function public.finish_oauth_disconnect(uuid, uuid, uuid) to service_role;
grant execute on function public.fail_oauth_disconnect(uuid, uuid, uuid, boolean, text) to service_role;
