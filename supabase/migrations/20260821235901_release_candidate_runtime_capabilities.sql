-- Release-candidate compatibility bridge.  Supabase projects with explicit
-- Data API grants do not treat service_role's BYPASSRLS bit as a table ACL;
-- grant only the server-side table operations used by the current routes.
revoke all privileges on table public.platform_admins from service_role;
grant select on table public.platform_admins to service_role;

revoke all privileges on table public.pilot_applications from service_role;
grant select, update on table public.pilot_applications to service_role;

revoke all privileges on table public.workspaces from service_role;
grant select, insert on table public.workspaces to service_role;

revoke all privileges on table public.invitations from service_role;
grant select, insert, update on table public.invitations to service_role;

revoke all privileges on table public.profiles from service_role;
grant select, update on table public.profiles to service_role;

revoke all privileges on table public.audit_events from service_role;
grant insert on table public.audit_events to service_role;

revoke all privileges on table public.cases from service_role;
grant select, insert on table public.cases to service_role;

revoke all privileges on table public.source_items from service_role;
grant select, insert, update on table public.source_items to service_role;

revoke all privileges on table public.execution_runs from service_role;
grant select, insert, update on table public.execution_runs to service_role;

revoke all privileges on table public.case_audience_variants from service_role;
grant select, insert, update on table public.case_audience_variants to service_role;

-- learning_records already had the narrow private-server capability in the
-- epistemic-layer migration.  Re-state the exact ACL so this bridge remains
-- correct on projects that apply migrations with explicit grants.
revoke all privileges on table public.learning_records from service_role;
grant select, update on table public.learning_records to service_role;

-- One transaction owns the outcome, optional learning, audit receipts, and
-- lifecycle completion.
create or replace function public.record_case_outcome_review(
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
  p_learning_note text,
  p_learning_applicability text,
  p_approve_adapted_learning boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  outcome_id uuid;
  learning_id uuid;
  candidate_note text := nullif(trim(coalesce(p_learning_note, '')), '');
  candidate_applicability text := nullif(trim(coalesce(p_learning_applicability, '')), '');
  learning_generated boolean := false;
  learning_approval text := 'not_proposed';
begin
  -- Lock before checking status so two requests cannot both complete the
  -- same outcome_pending case.  Membership is evaluated from auth.uid(), not
  -- from any client-supplied workspace identifier.
  select c.*
    into case_row
    from public.cases c
   where c.id = p_case_id
   for update;

  if case_row.id is null
     or auth.uid() is null
     or not exists (
       select 1
         from public.workspace_members m
        where m.workspace_id = case_row.workspace_id
          and m.user_id = auth.uid()
     ) then
    raise exception 'outcome not authorized';
  end if;
  if case_row.status <> 'outcome_pending' then
    raise exception 'outcome not pending';
  end if;
  if char_length(trim(coalesce(p_actual_result, ''))) = 0
     or char_length(trim(coalesce(p_next_action, ''))) = 0 then
    raise exception 'outcome requires next action';
  end if;
  if p_confidence not in ('low', 'medium', 'high') then
    raise exception 'invalid confidence';
  end if;

  -- Adapt is an approval of this exact candidate and exact applicability.
  -- It never claims evidence validation; validation_status remains pending.
  if p_learning_disposition = 'adapt'
     and (candidate_note is null
       or candidate_applicability is null
       or coalesce(p_approve_adapted_learning, false) is not true) then
    raise exception 'adapted learning requires exact candidate, applicability, and confirmation';
  end if;
  if p_learning_disposition = 'keep'
     and candidate_note is not null
     and candidate_applicability is null then
    raise exception 'learning applicability required';
  end if;

  insert into public.case_outcomes(
    workspace_id, case_id, expected_result, actual_result, evidence, confidence,
    what_worked, what_failed, blockers, next_action, improvements, other_angles,
    follow_up_date, learning_disposition, learning_note, reviewed_by,
    artifact_revision, learning_application_ids
  ) values (
    case_row.workspace_id, case_row.id, coalesce(p_expected_result, ''),
    trim(p_actual_result), coalesce(p_evidence, ''), p_confidence,
    coalesce(p_what_worked, ''), coalesce(p_what_failed, ''),
    coalesce(p_blockers, ''), trim(p_next_action), coalesce(p_improvements, ''),
    coalesce(p_other_angles, ''), p_follow_up_date, p_learning_disposition,
    candidate_note, auth.uid(), case_row.current_revision,
    coalesce((
      select array_agg(a.id order by a.id)
        from public.case_learning_applications a
       where a.workspace_id = case_row.workspace_id
         and a.case_id = case_row.id
         and a.artifact_revision = case_row.current_revision
    ), '{}'::uuid[])
  ) returning id into outcome_id;

  -- Keep and confirmed adapt may create one candidate.  Discard creates no
  -- learning row, and an insufficient keep candidate is represented by null.
  if p_learning_disposition <> 'discard' and candidate_note is not null then
    insert into public.learning_records(
      workspace_id, case_id, disposition, note, applicability, tags,
      supporting_outcome_count, learning_confidence, validation_status,
      approved_for_reuse, created_by
    ) values (
      case_row.workspace_id, case_row.id, p_learning_disposition,
      candidate_note, candidate_applicability, array[case_row.module::text],
      1, 'low', 'pending_validation',
      p_learning_disposition = 'adapt' and coalesce(p_approve_adapted_learning, false),
      auth.uid()
    ) returning id into learning_id;
    learning_generated := true;
    learning_approval := case when p_learning_disposition = 'adapt'
      then 'approved_for_reuse' else 'pending_review' end;
  end if;

  -- Audit metadata contains IDs and bounded state only; no outcome or
  -- learning content is copied into the audit stream.
  insert into public.audit_events(
    workspace_id, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    case_row.workspace_id, auth.uid(), 'outcome_recorded', 'case', case_row.id,
    jsonb_build_object(
      'learning_disposition', p_learning_disposition::text,
      'learning_id', learning_id,
      'learning_generated', learning_generated,
      'learning_approval', learning_approval
    )
  );
  if learning_generated then
    insert into public.audit_events(
      workspace_id, actor_id, event_type, entity_type, entity_id, metadata
    ) values (
      case_row.workspace_id, auth.uid(),
      case when p_learning_disposition = 'adapt'
        then 'learning.approved_for_reuse' else 'learning.proposed' end,
      'case', case_row.id,
      jsonb_build_object('learning_id', learning_id)
    );
  end if;

  update public.cases
     set status = 'completed'
   where id = case_row.id
     and workspace_id = case_row.workspace_id
     and status = 'outcome_pending';
  if not found then
    raise exception 'outcome completion conflict';
  end if;

  return jsonb_build_object(
    'completed', true,
    'learningRequested', p_learning_disposition <> 'discard',
    'outcomeId', outcome_id,
    'learningId', learning_id,
    'learningGenerated', learning_generated,
    'learningApproval', learning_approval
  );
end;
$$;

revoke all on function public.record_case_outcome_review(
  uuid, text, text, text, text, text, text, text, text, text, text, date,
  public.learning_disposition, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.record_case_outcome_review(
  uuid, text, text, text, text, text, text, text, text, text, text, date,
  public.learning_disposition, text, text, boolean
) to authenticated;

-- Keep the historical signature available to an old app during rollback,
-- but make it a constrained adapter instead of a bypass around the new
-- approval and audit contract.  A legacy client has no applicability field,
-- so it may complete keep/discard outcomes without creating reusable learning;
-- adapt must wait for the upgraded exact-candidate flow.
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
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  review_result jsonb;
begin
  if p_learning_disposition = 'adapt' then
    raise exception 'legacy outcome adaptation requires upgraded client';
  end if;

  review_result := public.record_case_outcome_review(
    p_case_id,
    p_expected_result,
    p_actual_result,
    p_evidence,
    p_confidence,
    p_what_worked,
    p_what_failed,
    p_blockers,
    p_next_action,
    p_improvements,
    p_other_angles,
    p_follow_up_date,
    p_learning_disposition,
    null,
    null,
    false
  );

  return (review_result ->> 'outcomeId')::uuid;
end;
$$;

revoke all on function public.record_case_outcome(
  uuid, text, text, text, text, text, text, text, text, text, text, date,
  public.learning_disposition, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_case_outcome(
  uuid, text, text, text, text, text, text, text, text, text, text, date,
  public.learning_disposition, text
) to authenticated;
