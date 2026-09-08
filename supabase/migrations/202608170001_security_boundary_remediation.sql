-- Security boundary remediation.  This migration narrows browser-callable
-- surfaces without changing existing tenant data or deleting applied objects.

-- Pilot applications are submitted through one service-role RPC so the public
-- rate-limit consume and the fixed-status insert happen in one transaction.
revoke insert on table public.pilot_applications from anon, authenticated;

create or replace function public.submit_pilot_application(
  p_email text,
  p_name text,
  p_company text default null,
  p_role text default null,
  p_goals text default null,
  p_locale text default 'en',
  p_website text default null,
  p_metadata_hash text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_id uuid;
begin
  if p_email is null or char_length(trim(p_email)) not between 3 and 320 or position('@' in trim(p_email)) < 2 then
    raise exception 'invalid application email';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 160 then
    raise exception 'invalid application name';
  end if;
  if p_company is not null and char_length(trim(p_company)) > 200 then raise exception 'invalid application company'; end if;
  if p_role is not null and char_length(trim(p_role)) > 200 then raise exception 'invalid application role'; end if;
  if p_goals is null or char_length(trim(p_goals)) not between 1 and 10000 then raise exception 'invalid application goals'; end if;
  if p_locale not in ('en', 'zh-Hant') then raise exception 'invalid application locale'; end if;
  if p_website is not null and char_length(p_website) > 2000 then raise exception 'invalid application website'; end if;
  if p_metadata_hash is not null and p_metadata_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid application metadata'; end if;

  if p_metadata_hash is not null and not public.consume_public_rate_limit('pilot_application', p_metadata_hash, 5) then
    return null;
  end if;

  insert into public.pilot_applications(email, name, company, role, goals, locale, website, metadata_hash, status)
    values (lower(trim(p_email)), trim(p_name), nullif(trim(p_company), ''), nullif(trim(p_role), ''), trim(p_goals), p_locale, nullif(trim(p_website), ''), p_metadata_hash, 'new')
    returning id into application_id;
  return application_id;
end $$;

revoke all on function public.submit_pilot_application(text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_pilot_application(text, text, text, text, text, text, text, text) to service_role;

-- Gmail execution RPCs retain their historical signatures for migration
-- compatibility, but no role can call them.  The explicit actor overloads
-- below are the only server route targets and remain service-role-only.
revoke all on function public.claim_case_action(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_case_action_executed(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_case_action_attempt(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_case_action_attempt(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_case_action_executed_attempt(uuid, uuid, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.record_case_action_reconciliation_check(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.claim_case_action_attempt(
  p_action_id uuid,
  p_idempotency_key text,
  p_provider_message_id text,
  p_connection_id uuid,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  action_row public.case_actions;
  connection_row public.oauth_connections;
  approval_id uuid;
  attempt_id uuid := gen_random_uuid();
begin
  if p_actor_id is null then return null; end if;
  select c.* into case_row
    from public.cases c
   where c.id = (select case_id from public.case_actions where id = p_action_id)
   for update;
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null then return null; end if;
  if case_row.id is null or case_row.id <> action_row.case_id or case_row.workspace_id <> action_row.workspace_id then return null; end if;
  if not exists (select 1 from public.workspace_members where workspace_id = case_row.workspace_id and user_id = p_actor_id) then return null; end if;
  if action_row.status <> 'pending' or action_row.idempotency_key <> p_idempotency_key then return null; end if;
  if p_provider_message_id is null or p_provider_message_id !~ '^<solo-os-[a-f0-9]{64}@actions\.solo-company-os\.invalid>$' then return null; end if;
  if case_row.status <> 'action_pending' then return null; end if;
  select * into connection_row from public.oauth_connections where id = p_connection_id and workspace_id = action_row.workspace_id and owner_user_id = p_actor_id for update;
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
         reconciliation_checked_at = null, execution_actor_id = p_actor_id,
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
  p_actor_id uuid,
  p_reconciled boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  action_row public.case_actions;
  connection_row public.oauth_connections;
begin
  if p_actor_id is null then return false; end if;
  select c.* into case_row from public.cases c where c.id = (select case_id from public.case_actions where id = p_action_id) for update;
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null then return false; end if;
  if case_row.id is null or case_row.id <> action_row.case_id or case_row.workspace_id <> action_row.workspace_id or action_row.status <> 'executing' then return false; end if;
  if action_row.execution_attempt_id is distinct from p_execution_attempt_id or action_row.provider_message_id is distinct from p_provider_message_id then return false; end if;
  if action_row.execution_actor_id is distinct from p_actor_id then return false; end if;
  if not exists (select 1 from public.workspace_members where workspace_id = action_row.workspace_id and user_id = p_actor_id) then return false; end if;
  select * into connection_row from public.oauth_connections where id = action_row.execution_connection_id and workspace_id = action_row.workspace_id and owner_user_id = p_actor_id for update;
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
    values (action_row.workspace_id, p_actor_id, 'action_executed', 'case_action', action_row.id, jsonb_build_object('provider', 'gmail', 'reconciled', coalesce(p_reconciled, false)));
  return true;
end $$;

create or replace function public.record_case_action_reconciliation_check(
  p_action_id uuid,
  p_execution_attempt_id uuid,
  p_actor_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare action_row public.case_actions;
begin
  if p_actor_id is null then return false; end if;
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null or action_row.status <> 'executing' or action_row.execution_attempt_id is distinct from p_execution_attempt_id then return false; end if;
  if action_row.execution_actor_id is distinct from p_actor_id then return false; end if;
  if not exists (select 1 from public.workspace_members where workspace_id = action_row.workspace_id and user_id = p_actor_id) then return false; end if;
  if not exists (select 1 from public.oauth_connections where id = action_row.execution_connection_id and workspace_id = action_row.workspace_id and owner_user_id = p_actor_id and status = 'active') then return false; end if;
  update public.case_actions set reconciliation_checked_at = now() where id = p_action_id;
  return true;
end $$;

revoke all on function public.claim_case_action_attempt(uuid, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_case_action_executed_attempt(uuid, uuid, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_case_action_reconciliation_check(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_case_action_attempt(uuid, text, text, uuid, uuid) to service_role;
grant execute on function public.mark_case_action_executed_attempt(uuid, uuid, text, text, uuid, boolean) to service_role;
grant execute on function public.record_case_action_reconciliation_check(uuid, uuid, uuid) to service_role;
