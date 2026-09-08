-- Durable Gmail draft execution state for safe provider reconciliation.
-- The provider marker is a hash-derived Message-ID; it contains no recipient,
-- subject, body, OAuth token, or other tenant content.

alter table public.case_actions
  add column execution_attempt_id uuid,
  add column execution_approval_id uuid references public.case_approvals(id),
  add column execution_started_at timestamptz,
  add column provider_message_id text,
  add column reconciliation_checked_at timestamptz;

alter table public.case_actions
  add constraint case_actions_provider_message_id_format check (
    provider_message_id is null or provider_message_id ~ '^<solo-os-[a-f0-9]{64}@actions\.solo-company-os\.invalid>$'
  ),
  add constraint case_actions_execution_claim_complete check (
    status <> 'executing' or (
      execution_attempt_id is not null and
      execution_approval_id is not null and
      execution_started_at is not null and
      provider_message_id is not null
    )
  ) not valid;

create unique index case_actions_provider_message_id_unique
  on public.case_actions(provider_message_id)
  where provider_message_id is not null;

create or replace function public.claim_case_action_attempt(
  p_action_id uuid,
  p_idempotency_key text,
  p_provider_message_id text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  action_row public.case_actions;
  approval_id uuid;
  attempt_id uuid := gen_random_uuid();
begin
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null or action_row.status <> 'pending' or action_row.idempotency_key <> p_idempotency_key then return null; end if;
  if not public.is_workspace_member(action_row.workspace_id) then return null; end if;
  if p_provider_message_id is null or p_provider_message_id !~ '^<solo-os-[a-f0-9]{64}@actions\.solo-company-os\.invalid>$' then return null; end if;
  if (select status from public.cases where id = action_row.case_id and workspace_id = action_row.workspace_id) <> 'action_pending' then return null; end if;

  select a.id into approval_id
    from public.case_approvals a
    join public.case_artifacts r
      on r.case_id = a.case_id
     and r.workspace_id = a.workspace_id
     and r.revision = a.artifact_revision
     and r.content_hash = a.artifact_hash
   where a.case_id = action_row.case_id
     and a.workspace_id = action_row.workspace_id
     and a.artifact_revision = action_row.artifact_revision
     and a.action_payload_hash = action_row.payload_hash
     and a.revoked_at is null
   order by a.approved_at desc
   limit 1;
  if approval_id is null then return null; end if;

  update public.case_actions
     set status = 'executing',
         execution_attempt_id = attempt_id,
         execution_approval_id = approval_id,
         execution_started_at = now(),
         provider_message_id = p_provider_message_id,
         reconciliation_checked_at = null
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
declare action_row public.case_actions;
begin
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null or action_row.status <> 'executing' then return false; end if;
  if action_row.execution_attempt_id is distinct from p_execution_attempt_id or action_row.provider_message_id is distinct from p_provider_message_id then return false; end if;
  if not public.is_workspace_member(action_row.workspace_id) then return false; end if;
  if char_length(coalesce(p_provider_reference, '')) < 1 or char_length(p_provider_reference) > 500 then return false; end if;
  if not exists (
    select 1
      from public.case_approvals a
      join public.case_artifacts r
        on r.case_id = a.case_id
       and r.workspace_id = a.workspace_id
       and r.revision = a.artifact_revision
       and r.content_hash = a.artifact_hash
     where a.id = action_row.execution_approval_id
       and a.case_id = action_row.case_id
       and a.workspace_id = action_row.workspace_id
       and a.artifact_revision = action_row.artifact_revision
       and a.action_payload_hash = action_row.payload_hash
  ) then return false; end if;

  update public.case_actions
     set status = 'executed',
         provider_reference = p_provider_reference,
         reconciliation_checked_at = case when coalesce(p_reconciled, false) then now() else reconciliation_checked_at end,
         executed_at = now()
   where id = p_action_id;
  update public.cases set status = 'outcome_pending' where id = action_row.case_id and status = 'action_pending';
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (action_row.workspace_id, auth.uid(), 'action_executed', 'case_action', action_row.id, jsonb_build_object('provider', 'gmail', 'reconciled', coalesce(p_reconciled, false)));
  return true;
end $$;

create or replace function public.record_case_action_reconciliation_check(
  p_action_id uuid,
  p_execution_attempt_id uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare action_row public.case_actions;
begin
  select * into action_row from public.case_actions where id = p_action_id for update;
  if action_row.id is null or action_row.status <> 'executing' or action_row.execution_attempt_id is distinct from p_execution_attempt_id then return false; end if;
  if not public.is_workspace_member(action_row.workspace_id) then return false; end if;
  update public.case_actions set reconciliation_checked_at = now() where id = p_action_id;
  return true;
end $$;

-- Retire the narrower claim/finalize RPCs from browser sessions. They remain in
-- the initial migration only for deterministic migration history.
revoke execute on function public.claim_case_action(uuid, text) from authenticated;
revoke execute on function public.mark_case_action_executed(uuid, text) from authenticated;

revoke all on function public.claim_case_action_attempt(uuid, text, text) from public, anon;
revoke all on function public.mark_case_action_executed_attempt(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.record_case_action_reconciliation_check(uuid, uuid) from public, anon;
grant execute on function public.claim_case_action_attempt(uuid, text, text) to authenticated;
grant execute on function public.mark_case_action_executed_attempt(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.record_case_action_reconciliation_check(uuid, uuid) to authenticated;
