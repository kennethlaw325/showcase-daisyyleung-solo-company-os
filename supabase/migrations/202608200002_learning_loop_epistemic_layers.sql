-- Learning-loop epistemic layers and work-packet lineage.
-- This migration is additive: historical learning text and outcome rows are
-- left untouched and receive null/unassessed epistemic fields.

alter table public.case_artifacts
  add column if not exists work_packet_source_artifact_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'artifacts_workspace_case_id_key'
       and conrelid = 'public.case_artifacts'::regclass
  ) then
    alter table public.case_artifacts
      add constraint artifacts_workspace_case_id_key unique (workspace_id, case_id, id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'artifacts_workspace_case_lineage_fk'
       and conrelid = 'public.case_artifacts'::regclass
  ) then
      alter table public.case_artifacts
      add constraint artifacts_workspace_case_lineage_fk
      foreign key (workspace_id, case_id, work_packet_source_artifact_id)
      references public.case_artifacts(workspace_id, case_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists case_artifacts_work_packet_source_idx
  on public.case_artifacts(workspace_id, case_id, work_packet_source_artifact_id)
  where work_packet_source_artifact_id is not null;

create or replace function public.reject_work_packet_lineage_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.work_packet_source_artifact_id is distinct from new.work_packet_source_artifact_id then
    raise exception 'work packet lineage is immutable';
  end if;
  return new;
end $$;

-- Backfill the nearest complete packet at or before every pre-migration
-- artifact revision. This preserves packet context across historical human
-- edits while leaving content, revisions, and learning text unchanged.
-- Cases with no complete evidence/plan pair stay null.
drop trigger if exists case_artifacts_work_packet_lineage_immutable on public.case_artifacts;
with packet_sources as (
  select artifact.id as artifact_id,
    (
      select candidate.id
        from public.case_artifacts candidate
       where candidate.workspace_id = artifact.workspace_id
         and candidate.case_id = artifact.case_id
         and candidate.revision <= artifact.revision
         and exists (
           select 1 from public.case_stage_outputs output
            where output.workspace_id = candidate.workspace_id
              and output.case_id = candidate.case_id
              and output.artifact_id = candidate.id
              and output.stage_key = 'evidence'
         )
         and exists (
           select 1 from public.case_stage_outputs output
            where output.workspace_id = candidate.workspace_id
              and output.case_id = candidate.case_id
              and output.artifact_id = candidate.id
              and output.stage_key = 'plan'
         )
       order by candidate.revision desc
       limit 1
    ) as packet_source_artifact_id
    from public.case_artifacts artifact
   where artifact.work_packet_source_artifact_id is null
)
update public.case_artifacts artifact
   set work_packet_source_artifact_id = packet_sources.packet_source_artifact_id
  from packet_sources
 where artifact.id = packet_sources.artifact_id
   and packet_sources.packet_source_artifact_id is not null;

create trigger case_artifacts_work_packet_lineage_immutable
before update on public.case_artifacts
for each row execute function public.reject_work_packet_lineage_mutation();

alter table public.learning_records
  add column if not exists applicability text,
  add column if not exists supporting_outcome_count integer,
  add column if not exists learning_confidence text,
  add column if not exists validation_status text;

-- The server-only outcome route updates the exact candidate row after the
-- outcome RPC returns.  Keep direct mutation unavailable to browser roles,
-- while granting the private service role the narrow read/update surface it
-- needs for that exact candidate binding.
grant select, update on table public.learning_records to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'learning_records_applicability_length'
       and conrelid = 'public.learning_records'::regclass
  ) then
    alter table public.learning_records
      add constraint learning_records_applicability_length
      check (applicability is null or char_length(applicability) between 1 and 4000);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'learning_records_supporting_outcome_count_valid'
       and conrelid = 'public.learning_records'::regclass
  ) then
    alter table public.learning_records
      add constraint learning_records_supporting_outcome_count_valid
      check (supporting_outcome_count is null or supporting_outcome_count >= 1);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'learning_records_learning_confidence_valid'
       and conrelid = 'public.learning_records'::regclass
  ) then
    alter table public.learning_records
      add constraint learning_records_learning_confidence_valid
      check (learning_confidence is null or learning_confidence in ('low', 'medium', 'high'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'learning_records_validation_status_valid'
       and conrelid = 'public.learning_records'::regclass
  ) then
    alter table public.learning_records
      add constraint learning_records_validation_status_valid
      check (validation_status is null or validation_status in ('pending_validation', 'validated', 'rejected'));
  end if;
end $$;

alter table public.case_learning_applications
  add column if not exists supporting_outcome_count_snapshot integer,
  add column if not exists learning_confidence_snapshot text,
  add column if not exists validation_status_snapshot text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'applications_supporting_outcome_count_snapshot_valid'
       and conrelid = 'public.case_learning_applications'::regclass
  ) then
    alter table public.case_learning_applications
      add constraint applications_supporting_outcome_count_snapshot_valid
      check (supporting_outcome_count_snapshot is null or supporting_outcome_count_snapshot >= 1);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'applications_learning_confidence_snapshot_valid'
       and conrelid = 'public.case_learning_applications'::regclass
  ) then
    alter table public.case_learning_applications
      add constraint applications_learning_confidence_snapshot_valid
      check (learning_confidence_snapshot is null or learning_confidence_snapshot in ('low', 'medium', 'high'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'applications_validation_status_snapshot_valid'
       and conrelid = 'public.case_learning_applications'::regclass
  ) then
    alter table public.case_learning_applications
      add constraint applications_validation_status_snapshot_valid
      check (validation_status_snapshot is null or validation_status_snapshot in ('pending_validation', 'validated', 'rejected'));
  end if;
end $$;

-- Resolve a packet source only when both supporting stages exist.  A missing
-- or one-sided historical output is deliberately treated as incomplete, not
-- as proof that a revision came from a legacy generator.
create or replace function public.resolve_case_work_packet_source_artifact(
  p_workspace_id uuid,
  p_case_id uuid,
  p_artifact_id uuid
) returns uuid
language plpgsql
stable
set search_path = public
as $$
declare resolved_id uuid;
begin
  select p_artifact_id
    into resolved_id
   where exists (
     select 1 from public.case_stage_outputs
      where workspace_id = p_workspace_id
        and case_id = p_case_id
        and artifact_id = p_artifact_id
        and stage_key = 'evidence'
   )
   and exists (
     select 1 from public.case_stage_outputs
      where workspace_id = p_workspace_id
        and case_id = p_case_id
        and artifact_id = p_artifact_id
        and stage_key = 'plan'
   );
  return resolved_id;
end $$;

-- AI packet finalization binds the source to the artifact itself.  Existing
-- application and snapshot validation remains unchanged except for the new
-- epistemic fields captured below.
create or replace function public.finalize_case_work_packet(
  p_actor_id uuid,
  p_case_id uuid,
  p_expected_revision integer,
  p_execution_run_id uuid,
  p_content jsonb,
  p_content_locale text,
  p_evidence jsonb,
  p_plan jsonb,
  p_selected_learning_ids uuid[],
  p_application_accounting jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  case_row public.cases;
  run_row public.execution_runs;
  learning_row public.learning_records;
  source_case_row public.cases;
  source_outcome_row public.case_outcomes;
  selected_id uuid;
  application_item jsonb;
  learning_id_text text;
  learning_id uuid;
  disposition_text text;
  rationale_text text;
  artifact_id uuid;
  next_revision integer;
  application_count integer;
  application_items jsonb[] := '{}';
  selected_ids uuid[] := coalesce(p_selected_learning_ids, '{}'::uuid[]);
  seen_ids uuid[] := '{}'::uuid[];
  snapshot jsonb;
  snapshot_hash text;
  computed_content_hash text;
begin
  select * into case_row from public.cases where id = p_case_id for update;
  if case_row.id is null or p_actor_id is null or not exists (
    select 1 from public.workspace_members where workspace_id = case_row.workspace_id and user_id = p_actor_id
  ) then raise exception 'not authorized'; end if;
  if p_expected_revision is null or case_row.current_revision is distinct from p_expected_revision then raise exception 'stale case revision'; end if;
  if case_row.status in ('completed', 'cancelled', 'outcome_pending') then raise exception 'case cannot generate a work packet'; end if;
  if cardinality(selected_ids) > 3 then raise exception 'no more than three learnings may be selected'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(p_evidence) <> 'object' or jsonb_typeof(p_plan) <> 'object'
     or p_content_locale not in ('en', 'zh-Hant') then raise exception 'invalid work packet envelope'; end if;
  if char_length(trim(coalesce(p_content->>'title', ''))) = 0
     or char_length(trim(coalesce(p_content->>'summary', ''))) = 0
     or char_length(trim(coalesce(p_content->>'body', ''))) = 0
     or char_length(trim(coalesce(p_content->>'next_action', ''))) = 0 then raise exception 'invalid deliverable content'; end if;
  computed_content_hash := encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex');
  if jsonb_typeof(coalesce(p_application_accounting, '[]'::jsonb)) <> 'array' then raise exception 'learning application accounting must be an array'; end if;
  select count(*) into application_count from jsonb_array_elements(coalesce(p_application_accounting, '[]'::jsonb));
  if application_count <> cardinality(selected_ids) then raise exception 'learning application accounting does not match selections'; end if;
  select coalesce(array_agg(value), '{}'::jsonb[]) into application_items from jsonb_array_elements(coalesce(p_application_accounting, '[]'::jsonb));

  foreach selected_id in array selected_ids loop
    if selected_id = any(seen_ids) then raise exception 'duplicate learning selection'; end if;
    seen_ids := array_append(seen_ids, selected_id);
    select lr.* into learning_row
      from public.learning_records lr
      join public.cases source_case on source_case.id = lr.case_id and source_case.workspace_id = lr.workspace_id
     where lr.id = selected_id and lr.workspace_id = case_row.workspace_id
       and lr.approved_for_reuse = true and lr.disposition <> 'discard'
       and source_case.module = case_row.module
     for update;
    if learning_row.id is null then raise exception 'selected learning is unavailable or does not match the case module'; end if;
  end loop;

  seen_ids := '{}'::uuid[];
  foreach application_item in array application_items loop
    learning_id_text := nullif(trim(coalesce(application_item->>'learningId', application_item->>'learning_id')), '');
    if learning_id_text is null then raise exception 'learning application ID is required'; end if;
    begin learning_id := learning_id_text::uuid; exception when invalid_text_representation then raise exception 'learning application ID is invalid'; end;
    if learning_id = any(seen_ids) then raise exception 'duplicate learning application'; end if;
    seen_ids := array_append(seen_ids, learning_id);
    if not (learning_id = any(selected_ids)) then raise exception 'learning application references an unselected learning'; end if;
    disposition_text := lower(trim(coalesce(application_item->>'disposition', '')));
    if disposition_text not in ('applied', 'partially_applied', 'not_applied', 'conflicted') then raise exception 'invalid learning application disposition'; end if;
    rationale_text := trim(coalesce(application_item->>'rationale', ''));
    if char_length(rationale_text) < 1 or char_length(rationale_text) > 4000 then raise exception 'learning application rationale is required'; end if;
  end loop;
  foreach selected_id in array selected_ids loop
    if not (selected_id = any(seen_ids)) then raise exception 'learning application is missing a selected learning'; end if;
  end loop;

  select * into run_row from public.execution_runs
   where id = p_execution_run_id and workspace_id = case_row.workspace_id
     and case_id = case_row.id and created_by = p_actor_id and status = 'succeeded' for update;
  if run_row.id is null then raise exception 'execution run is unavailable'; end if;

  next_revision := case_row.current_revision + 1;
  artifact_id := gen_random_uuid();
  insert into public.case_artifacts(
    id, workspace_id, case_id, revision, kind, content, content_hash,
    template_key, template_version, content_locale, work_packet_source_artifact_id, created_by
  ) values (
    artifact_id, case_row.workspace_id, case_row.id, next_revision, 'synthesis', p_content,
    computed_content_hash, case_row.template_key, case_row.template_version, p_content_locale,
    artifact_id, p_actor_id
  );

  insert into public.case_stage_outputs(
    workspace_id, case_id, artifact_id, execution_run_id, stage_key,
    schema_version, content_locale, output, output_hash, created_by
  ) values
    (case_row.workspace_id, case_row.id, artifact_id, run_row.id, 'evidence', 1, p_content_locale, p_evidence,
      encode(extensions.digest(convert_to(p_evidence::text, 'UTF8'), 'sha256'), 'hex'), p_actor_id),
    (case_row.workspace_id, case_row.id, artifact_id, run_row.id, 'plan', 1, p_content_locale, p_plan,
      encode(extensions.digest(convert_to(p_plan::text, 'UTF8'), 'sha256'), 'hex'), p_actor_id);

  foreach application_item in array application_items loop
    learning_id := coalesce(nullif(trim(application_item->>'learningId'), ''), nullif(trim(application_item->>'learning_id'), ''))::uuid;
    select * into learning_row from public.learning_records lr
      join public.cases source_case on source_case.id = lr.case_id and source_case.workspace_id = lr.workspace_id
     where lr.id = learning_id and lr.workspace_id = case_row.workspace_id
       and lr.approved_for_reuse = true and lr.disposition <> 'discard'
       and source_case.module = case_row.module for update;
    select * into source_case_row from public.cases where id = learning_row.case_id and workspace_id = case_row.workspace_id;
    select * into source_outcome_row from public.case_outcomes where case_id = source_case_row.id and workspace_id = case_row.workspace_id;
    snapshot := jsonb_build_object(
      'learningId', learning_row.id, 'note', learning_row.note, 'tags', to_jsonb(learning_row.tags),
      'sourceCaseId', source_case_row.id, 'sourceCaseTitle', source_case_row.title,
      'applicability', learning_row.applicability, 'sourceOutcomeId', source_outcome_row.id,
      'evidence', nullif(trim(source_outcome_row.evidence), ''), 'confidence', source_outcome_row.confidence,
      'supportingOutcomeCount', learning_row.supporting_outcome_count,
      'learningConfidence', learning_row.learning_confidence,
      'validationStatus', learning_row.validation_status,
      'nextAction', nullif(trim(source_outcome_row.next_action), ''),
      'otherAngles', nullif(trim(source_outcome_row.other_angles), '')
    );
    snapshot_hash := encode(extensions.digest(convert_to(snapshot::text, 'UTF8'), 'sha256'), 'hex');
    insert into public.case_learning_applications(
      workspace_id, case_id, artifact_id, artifact_revision, execution_run_id,
      learning_id, source_case_id, source_outcome_id, disposition, rationale,
      learning_note_snapshot, learning_tags_snapshot, source_case_title_snapshot,
      applicability_snapshot, evidence_snapshot, confidence_snapshot,
      supporting_outcome_count_snapshot, learning_confidence_snapshot, validation_status_snapshot,
      next_action_snapshot, improvements_snapshot, other_angles_snapshot,
      learning_snapshot_hash, applied_by
    ) values (
      case_row.workspace_id, case_row.id, artifact_id, next_revision, run_row.id,
      learning_id, source_case_row.id, source_outcome_row.id,
      lower(trim(application_item->>'disposition'))::public.learning_application_disposition,
      trim(application_item->>'rationale'), learning_row.note, learning_row.tags,
      source_case_row.title, learning_row.applicability, nullif(trim(source_outcome_row.evidence), ''), source_outcome_row.confidence,
      learning_row.supporting_outcome_count, learning_row.learning_confidence, learning_row.validation_status,
      nullif(trim(source_outcome_row.next_action), ''), nullif(trim(source_outcome_row.improvements), ''),
      nullif(trim(source_outcome_row.other_angles), ''), snapshot_hash, p_actor_id
    );
  end loop;

  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (case_row.workspace_id, p_actor_id, 'case.revision_generated', 'case', case_row.id,
      jsonb_build_object('revision', next_revision, 'stage_key', 'work_packet', 'source_count',
        (select count(*) from public.source_items where workspace_id = case_row.workspace_id and case_id = case_row.id and extraction_status = 'extracted')));
  update public.cases set current_revision = next_revision, status = 'awaiting_approval'
   where id = case_row.id and workspace_id = case_row.workspace_id;
  return jsonb_build_object(
    'case', jsonb_build_object('id', case_row.id, 'status', 'awaiting_approval', 'current_revision', next_revision),
    'artifact', jsonb_build_object('id', artifact_id, 'revision', next_revision, 'content_hash', computed_content_hash,
      'content', p_content, 'content_locale', p_content_locale),
    'artifactRevision', next_revision, 'artifactHash', computed_content_hash,
    'selectedLearningCount', cardinality(selected_ids)
  );
end $$;

revoke all on function public.finalize_case_work_packet(uuid, uuid, integer, uuid, jsonb, text, jsonb, jsonb, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.finalize_case_work_packet(uuid, uuid, integer, uuid, jsonb, text, jsonb, jsonb, uuid[], jsonb) to service_role;

-- Outcome reviews retain the original signature for existing clients while
-- making discard a true outcome-only disposition and initializing every new
-- candidate with one low-confidence, pending-validation observation.
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
declare
  case_row public.cases;
  result_id uuid;
begin
  select * into case_row from public.cases where id = p_case_id for update;
  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) or case_row.status <> 'outcome_pending' then raise exception 'outcome not pending'; end if;
  if char_length(trim(coalesce(p_actual_result, ''))) = 0 or char_length(trim(coalesce(p_next_action, ''))) = 0 then raise exception 'outcome requires next action'; end if;
  if p_confidence not in ('low', 'medium', 'high') then raise exception 'invalid confidence'; end if;
  insert into public.case_outcomes(
    workspace_id, case_id, expected_result, actual_result, evidence, confidence,
    what_worked, what_failed, blockers, next_action, improvements, other_angles,
    follow_up_date, learning_disposition, learning_note, reviewed_by,
    artifact_revision, learning_application_ids
  ) values (
    case_row.workspace_id, case_row.id, coalesce(p_expected_result, ''), p_actual_result,
    coalesce(p_evidence, ''), p_confidence, coalesce(p_what_worked, ''),
    coalesce(p_what_failed, ''), coalesce(p_blockers, ''), p_next_action,
    coalesce(p_improvements, ''), coalesce(p_other_angles, ''), p_follow_up_date,
    p_learning_disposition, p_learning_note, auth.uid(), case_row.current_revision,
    coalesce((select array_agg(id order by id) from public.case_learning_applications
      where workspace_id = case_row.workspace_id and case_id = case_row.id and artifact_revision = case_row.current_revision), '{}'::uuid[])
  ) returning id into result_id;
  if p_learning_disposition <> 'discard' and nullif(trim(coalesce(p_learning_note, '')), '') is not null then
    insert into public.learning_records(
      workspace_id, case_id, disposition, note, tags, supporting_outcome_count,
      learning_confidence, validation_status, created_by
    ) values (
      case_row.workspace_id, case_row.id, p_learning_disposition, trim(p_learning_note),
      array[case_row.module::text], 1, 'low', 'pending_validation', auth.uid()
    );
  end if;
  update public.cases set status = 'completed' where id = p_case_id and workspace_id = case_row.workspace_id;
  return result_id;
end $$;

revoke all on function public.record_case_outcome(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text) from public, anon;
grant execute on function public.record_case_outcome(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text) to authenticated;

-- Explicit confirmation controls reuse only.  It never changes learning
-- confidence or validation status; evidence validation remains a separate
-- epistemic step.
create or replace function public.confirm_learning_for_reuse(p_learning_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare learning_workspace uuid;
begin
  select workspace_id into learning_workspace
    from public.learning_records
   where id = p_learning_id and disposition <> 'discard' and deleted_at is null
   for update;
  if learning_workspace is null or not public.is_workspace_member(learning_workspace) then return false; end if;
  update public.learning_records set approved_for_reuse = true
   where id = p_learning_id and workspace_id = learning_workspace and deleted_at is null;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (learning_workspace, auth.uid(), 'learning.confirmed', 'learning_record', p_learning_id, '{}');
  return found;
end $$;

revoke all on function public.confirm_learning_for_reuse(uuid) from public, anon;
grant execute on function public.confirm_learning_for_reuse(uuid) to authenticated;

-- Human edits inherit the resolved packet source.  A current artifact with a
-- complete packet resolves to itself; one-sided/absent historical outputs
-- intentionally remain null so the UI can explain the exact state.
create or replace function public.create_case_revision(
  p_case_id uuid,
  p_expected_revision integer,
  p_content jsonb,
  p_content_locale text,
  p_action jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  previous_artifact public.case_artifacts;
  current_action public.case_actions;
  next_revision integer;
  artifact_id uuid;
  action_id uuid;
  action_payload jsonb;
  artifact_hash text;
  action_hash text;
  recipient text;
  packet_source_artifact_id uuid;
begin
  select * into case_row from public.cases where id = p_case_id for update;
  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) then raise exception 'not authorized'; end if;
  if p_expected_revision is null or case_row.current_revision is distinct from p_expected_revision then raise exception 'stale case revision'; end if;
  if case_row.status in ('completed', 'cancelled') then raise exception 'case cannot be edited'; end if;
  if case_row.status not in ('awaiting_approval', 'action_pending', 'outcome_pending') then raise exception 'case cannot be edited in its current state'; end if;
  if jsonb_typeof(p_content) <> 'object'
     or not (p_content ?& array['title', 'summary', 'body', 'next_action'])
     or exists (select 1 from jsonb_object_keys(p_content) as content_key where content_key not in ('title', 'summary', 'body', 'next_action'))
     or jsonb_typeof(p_content->'title') <> 'string' or jsonb_typeof(p_content->'summary') <> 'string'
     or jsonb_typeof(p_content->'body') <> 'string' or jsonb_typeof(p_content->'next_action') <> 'string'
     or char_length(trim(coalesce(p_content->>'title', ''))) not between 1 and 200
     or char_length(trim(coalesce(p_content->>'summary', ''))) not between 1 and 20000
     or char_length(trim(coalesce(p_content->>'body', ''))) not between 1 and 100000
     or char_length(trim(coalesce(p_content->>'next_action', ''))) not between 1 and 2000 then raise exception 'invalid revision content'; end if;
  if p_content_locale not in ('en', 'zh-Hant') then raise exception 'invalid content locale'; end if;

  select * into previous_artifact from public.case_artifacts
   where case_id = case_row.id and workspace_id = case_row.workspace_id and revision = case_row.current_revision for update;
  if previous_artifact.id is null then raise exception 'current artifact unavailable'; end if;
  packet_source_artifact_id := previous_artifact.work_packet_source_artifact_id;
  if packet_source_artifact_id is null then
    packet_source_artifact_id := public.resolve_case_work_packet_source_artifact(case_row.workspace_id, case_row.id, previous_artifact.id);
  end if;

  select * into current_action from public.case_actions
   where case_id = case_row.id and workspace_id = case_row.workspace_id and artifact_revision = case_row.current_revision
   order by created_at desc limit 1 for update;
  if current_action.id is not null and current_action.status in ('executing', 'executed') then raise exception 'action is already executing or executed'; end if;
  if case_row.status = 'action_pending' and (current_action.id is null or current_action.status <> 'pending') then raise exception 'action is not editable'; end if;
  if case_row.status = 'outcome_pending' then
    if case_row.module <> 'intelligence' then raise exception 'completed action cannot be edited'; end if;
    if current_action.id is not null then raise exception 'action is already executing or executed'; end if;
    if exists (select 1 from public.case_outcomes where case_id = case_row.id and workspace_id = case_row.workspace_id) then raise exception 'case outcome already recorded'; end if;
  end if;

  if case_row.module = 'intelligence' then
    if p_action is not null then raise exception 'intelligence revisions cannot include an external action'; end if;
  else
    if p_action is null then
      if current_action.id is null or current_action.status <> 'pending' then raise exception 'exact action payload is required'; end if;
      action_payload := current_action.payload;
    else action_payload := p_action; end if;
    if jsonb_typeof(action_payload) <> 'object'
       or not (action_payload ?& array['to', 'subject', 'body'])
       or exists (select 1 from jsonb_object_keys(action_payload) as action_key where action_key not in ('to', 'cc', 'bcc', 'subject', 'body', 'thread_id'))
       or jsonb_typeof(action_payload->'to') <> 'string' or jsonb_typeof(action_payload->'subject') <> 'string'
       or jsonb_typeof(action_payload->'body') <> 'string'
       or char_length(trim(coalesce(action_payload->>'to', ''))) not between 3 and 320
       or position('@' in (action_payload->>'to')) < 2
       or lower(trim(action_payload->>'to')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       or char_length(trim(coalesce(action_payload->>'subject', ''))) not between 1 and 998
       or char_length(trim(coalesce(action_payload->>'body', ''))) not between 1 and 100000 then raise exception 'invalid action payload'; end if;
    if action_payload ? 'cc' then
      if jsonb_typeof(action_payload->'cc') <> 'array' or jsonb_array_length(action_payload->'cc') > 20 then raise exception 'invalid action payload'; end if;
      for recipient in select value from jsonb_array_elements_text(action_payload->'cc') as values(value) loop
        if char_length(trim(recipient)) not between 3 and 320 or lower(trim(recipient)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid action payload'; end if;
      end loop;
    end if;
    if action_payload ? 'bcc' then
      if jsonb_typeof(action_payload->'bcc') <> 'array' or jsonb_array_length(action_payload->'bcc') > 20 then raise exception 'invalid action payload'; end if;
      for recipient in select value from jsonb_array_elements_text(action_payload->'bcc') as values(value) loop
        if char_length(trim(recipient)) not between 3 and 320 or lower(trim(recipient)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid action payload'; end if;
      end loop;
    end if;
    if action_payload ? 'thread_id' and (jsonb_typeof(action_payload->'thread_id') <> 'string' or char_length(trim(action_payload->>'thread_id')) > 255) then raise exception 'invalid action payload'; end if;
  end if;
  if p_content = previous_artifact.content and (case_row.module = 'intelligence' or (current_action.id is not null and action_payload = current_action.payload)) then raise exception 'no changes to save'; end if;

  next_revision := case_row.current_revision + 1;
  artifact_id := gen_random_uuid();
  artifact_hash := encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.case_artifacts(
    id, workspace_id, case_id, revision, kind, content, content_hash,
    template_key, template_version, content_locale, work_packet_source_artifact_id, created_by
  ) values (
    artifact_id, case_row.workspace_id, case_row.id, next_revision, 'synthesis', p_content, artifact_hash,
    case_row.template_key, case_row.template_version, p_content_locale, packet_source_artifact_id, auth.uid()
  );
  update public.case_audience_variants set stale = true
   where case_id = case_row.id and workspace_id = case_row.workspace_id and artifact_revision < next_revision and stale = false;
  if current_action.id is not null and current_action.status = 'pending' then update public.case_actions set status = 'cancelled' where id = current_action.id; end if;
  if case_row.module <> 'intelligence' then
    action_hash := encode(extensions.digest(convert_to(action_payload::text, 'UTF8'), 'sha256'), 'hex');
    insert into public.case_actions(workspace_id, case_id, artifact_revision, action_type, payload, payload_hash, idempotency_key, created_by)
      values (case_row.workspace_id, case_row.id, next_revision, 'gmail.create_draft', action_payload, action_hash, gen_random_uuid()::text, auth.uid()) returning id into action_id;
  end if;
  update public.cases set title = p_content->>'title', current_revision = next_revision, status = 'awaiting_approval'
   where id = case_row.id and workspace_id = case_row.workspace_id;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (case_row.workspace_id, auth.uid(), 'case.revision_edited', 'case', case_row.id,
      jsonb_build_object('artifact_revision', next_revision, 'source_revision', case_row.current_revision,
        'work_packet_source_artifact_id', packet_source_artifact_id));
  return jsonb_build_object('case_id', case_row.id, 'revision', next_revision, 'artifact_id', artifact_id,
    'artifact_hash', artifact_hash, 'action_id', action_id, 'action_payload_hash', action_hash);
end;
$$;

revoke all on function public.create_case_revision(uuid, integer, jsonb, text, jsonb) from public, anon;
grant execute on function public.create_case_revision(uuid, integer, jsonb, text, jsonb) to authenticated;

revoke all on function public.resolve_case_work_packet_source_artifact(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_case_work_packet_source_artifact(uuid, uuid, uuid) to service_role;
