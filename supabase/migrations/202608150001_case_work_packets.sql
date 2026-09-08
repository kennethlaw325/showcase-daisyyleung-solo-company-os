-- Lightweight work packets: one evidence/plan response, one ordinary artifact
-- revision, and exact learning application accounting. This deliberately does
-- not introduce a stage-run or workflow registry engine.

do $$
begin
  create type public.learning_application_disposition as enum ('applied', 'partially_applied', 'not_applied', 'conflicted');
exception when duplicate_object then null;
end $$;

-- Composite child FKs keep the tenant discriminator inseparable from IDs.
-- Catalog guards make this compatible with environments where a prior
-- migration already established the same named tenant-safe key.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'artifacts_workspace_id_key' and conrelid = 'public.case_artifacts'::regclass) then
    alter table public.case_artifacts add constraint artifacts_workspace_id_key unique (workspace_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'executions_workspace_id_key' and conrelid = 'public.execution_runs'::regclass) then
    alter table public.execution_runs add constraint executions_workspace_id_key unique (workspace_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'learnings_workspace_id_key' and conrelid = 'public.learning_records'::regclass) then
    alter table public.learning_records add constraint learnings_workspace_id_key unique (workspace_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artifacts_workspace_case_revision_key' and conrelid = 'public.case_artifacts'::regclass) then
    alter table public.case_artifacts add constraint artifacts_workspace_case_revision_key unique (workspace_id, case_id, revision);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outcomes_workspace_id_key' and conrelid = 'public.case_outcomes'::regclass) then
    alter table public.case_outcomes add constraint outcomes_workspace_id_key unique (workspace_id, id);
  end if;
end $$;

create table public.case_stage_outputs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null,
  artifact_id uuid not null,
  execution_run_id uuid not null,
  stage_key text not null check (stage_key in ('evidence', 'plan')),
  schema_version integer not null default 1 check (schema_version > 0),
  content_locale text not null check (content_locale in ('en', 'zh-Hant')),
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  output_hash text not null check (output_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint stage_outputs_workspace_case_fk foreign key (workspace_id, case_id)
    references public.cases(workspace_id, id) on delete cascade,
  constraint stage_outputs_workspace_artifact_fk foreign key (workspace_id, artifact_id)
    references public.case_artifacts(workspace_id, id) on delete cascade,
  constraint stage_outputs_workspace_execution_fk foreign key (workspace_id, execution_run_id)
    references public.execution_runs(workspace_id, id) on delete cascade,
  constraint stage_outputs_artifact_stage_key unique (workspace_id, artifact_id, stage_key),
  constraint stage_outputs_execution_stage_key unique (workspace_id, execution_run_id, stage_key)
);

create index case_stage_outputs_case_idx on public.case_stage_outputs(workspace_id, case_id, created_at desc);

create table public.case_learning_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null,
  artifact_id uuid not null,
  artifact_revision integer not null check (artifact_revision > 0),
  execution_run_id uuid not null,
  learning_id uuid not null,
  source_case_id uuid not null,
  source_outcome_id uuid,
  disposition public.learning_application_disposition not null,
  rationale text not null check (char_length(trim(rationale)) between 1 and 4000),
  learning_note_snapshot text not null,
  learning_tags_snapshot text[] not null default '{}',
  source_case_title_snapshot text not null,
  applicability_snapshot text,
  evidence_snapshot text,
  confidence_snapshot text check (confidence_snapshot is null or confidence_snapshot in ('low', 'medium', 'high')),
  next_action_snapshot text,
  improvements_snapshot text,
  other_angles_snapshot text,
  learning_snapshot_hash text not null check (learning_snapshot_hash ~ '^[a-f0-9]{64}$'),
  applied_by uuid not null references auth.users(id),
  applied_at timestamptz not null default now(),
  constraint applications_workspace_case_fk foreign key (workspace_id, case_id)
    references public.cases(workspace_id, id) on delete cascade,
  constraint applications_workspace_artifact_fk foreign key (workspace_id, artifact_id)
    references public.case_artifacts(workspace_id, id) on delete cascade,
  constraint applications_workspace_execution_fk foreign key (workspace_id, execution_run_id)
    references public.execution_runs(workspace_id, id) on delete cascade,
  constraint applications_workspace_learning_fk foreign key (workspace_id, learning_id)
    references public.learning_records(workspace_id, id) on delete restrict,
  constraint applications_workspace_source_case_fk foreign key (workspace_id, source_case_id)
    references public.cases(workspace_id, id) on delete restrict,
  constraint applications_workspace_source_outcome_fk foreign key (workspace_id, source_outcome_id)
    references public.case_outcomes(workspace_id, id) on delete restrict,
  constraint applications_workspace_artifact_learning_key unique (workspace_id, artifact_id, learning_id),
  constraint applications_workspace_run_learning_key unique (workspace_id, execution_run_id, learning_id),
  constraint applications_workspace_case_revision_learning_key unique (workspace_id, case_id, artifact_revision, learning_id)
);

create index case_learning_applications_case_idx on public.case_learning_applications(workspace_id, case_id, artifact_revision);

alter table public.case_stage_outputs enable row level security;
alter table public.case_learning_applications enable row level security;

create policy case_stage_outputs_member_select on public.case_stage_outputs
  for select using (public.is_workspace_member(workspace_id));
create policy case_learning_applications_member_select on public.case_learning_applications
  for select using (public.is_workspace_member(workspace_id));

create or replace function public.reject_case_work_packet_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'case work packet records are immutable';
end $$;

create trigger case_stage_outputs_immutable
before update or delete on public.case_stage_outputs
for each row execute function public.reject_case_work_packet_mutation();
create trigger case_learning_applications_immutable
before update or delete on public.case_learning_applications
for each row execute function public.reject_case_work_packet_mutation();

-- The browser can read packet context through RLS but can only mutate the
-- lifecycle through the membership-checked finalize RPC below.
revoke all privileges on table public.case_stage_outputs, public.case_learning_applications from public, anon, authenticated;
grant select on table public.case_stage_outputs, public.case_learning_applications to authenticated;

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
  select * into case_row
    from public.cases
   where id = p_case_id
   for update;
  if case_row.id is null or p_actor_id is null or not exists (
    select 1 from public.workspace_members
     where workspace_id = case_row.workspace_id and user_id = p_actor_id
  ) then
    raise exception 'not authorized';
  end if;
  if p_expected_revision is null or case_row.current_revision is distinct from p_expected_revision then
    raise exception 'stale case revision';
  end if;
  if case_row.status in ('completed', 'cancelled', 'outcome_pending') then
    raise exception 'case cannot generate a work packet';
  end if;
  if cardinality(selected_ids) > 3 then
    raise exception 'no more than three learnings may be selected';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or jsonb_typeof(p_evidence) <> 'object'
     or jsonb_typeof(p_plan) <> 'object'
     or p_content_locale not in ('en', 'zh-Hant') then
    raise exception 'invalid work packet envelope';
  end if;
  if char_length(trim(coalesce(p_content->>'title', ''))) = 0
     or char_length(trim(coalesce(p_content->>'summary', ''))) = 0
     or char_length(trim(coalesce(p_content->>'body', ''))) = 0
     or char_length(trim(coalesce(p_content->>'next_action', ''))) = 0 then
    raise exception 'invalid deliverable content';
  end if;
  -- JSONB canonical ordering is database-defined, so compute the durable hash
  -- here rather than trusting a client-calculated ordering.
  computed_content_hash := encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex');
  if jsonb_typeof(coalesce(p_application_accounting, '[]'::jsonb)) <> 'array' then
    raise exception 'learning application accounting must be an array';
  end if;
  select count(*) into application_count from jsonb_array_elements(coalesce(p_application_accounting, '[]'::jsonb));
  if application_count <> cardinality(selected_ids) then
    raise exception 'learning application accounting does not match selections';
  end if;
  select coalesce(array_agg(value), '{}'::jsonb[]) into application_items
    from jsonb_array_elements(coalesce(p_application_accounting, '[]'::jsonb));

  -- Lock and validate every selected record in the verified workspace. The
  -- source case module is authoritative; client-supplied module is ignored.
  foreach selected_id in array selected_ids loop
    if selected_id = any(seen_ids) then raise exception 'duplicate learning selection'; end if;
    seen_ids := array_append(seen_ids, selected_id);
    select lr.* into learning_row
      from public.learning_records lr
      join public.cases source_case
        on source_case.id = lr.case_id
       and source_case.workspace_id = lr.workspace_id
     where lr.id = selected_id
       and lr.workspace_id = case_row.workspace_id
       and lr.approved_for_reuse = true
       and lr.disposition <> 'discard'
       and source_case.module = case_row.module
     for update;
    if learning_row.id is null then
      raise exception 'selected learning is unavailable or does not match the case module';
    end if;
  end loop;

  -- Validate exact one-to-one accounting before creating any durable row.
  seen_ids := '{}'::uuid[];
  foreach application_item in array application_items loop
    learning_id_text := nullif(trim(coalesce(application_item->>'learningId', application_item->>'learning_id')), '');
    if learning_id_text is null then raise exception 'learning application ID is required'; end if;
    begin
      learning_id := learning_id_text::uuid;
    exception when invalid_text_representation then
      raise exception 'learning application ID is invalid';
    end;
    if learning_id = any(seen_ids) then raise exception 'duplicate learning application'; end if;
    seen_ids := array_append(seen_ids, learning_id);
    if not (learning_id = any(selected_ids)) then raise exception 'learning application references an unselected learning'; end if;
    disposition_text := lower(trim(coalesce(application_item->>'disposition', '')));
    if disposition_text not in ('applied', 'partially_applied', 'not_applied', 'conflicted') then
      raise exception 'invalid learning application disposition';
    end if;
    rationale_text := trim(coalesce(application_item->>'rationale', ''));
    if char_length(rationale_text) < 1 or char_length(rationale_text) > 4000 then
      raise exception 'learning application rationale is required';
    end if;
  end loop;
  foreach selected_id in array selected_ids loop
    if not (selected_id = any(seen_ids)) then raise exception 'learning application is missing a selected learning'; end if;
  end loop;

  select * into run_row
    from public.execution_runs
   where id = p_execution_run_id
     and workspace_id = case_row.workspace_id
     and case_id = case_row.id
     and created_by = p_actor_id
     and status = 'succeeded'
   for update;
  if run_row.id is null then raise exception 'execution run is unavailable'; end if;

  next_revision := case_row.current_revision + 1;
  insert into public.case_artifacts(
    workspace_id, case_id, revision, kind, content, content_hash,
    template_key, template_version, content_locale, created_by
  ) values (
    case_row.workspace_id, case_row.id, next_revision, 'synthesis', p_content,
    computed_content_hash, case_row.template_key, case_row.template_version,
    p_content_locale, p_actor_id
  ) returning id into artifact_id;

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
    select * into learning_row
      from public.learning_records lr
      join public.cases source_case
        on source_case.id = lr.case_id
       and source_case.workspace_id = lr.workspace_id
     where lr.id = learning_id
       and lr.workspace_id = case_row.workspace_id
       and lr.approved_for_reuse = true
       and lr.disposition <> 'discard'
       and source_case.module = case_row.module
     for update;
    select * into source_case_row
      from public.cases
     where id = learning_row.case_id and workspace_id = case_row.workspace_id;
    select * into source_outcome_row
      from public.case_outcomes
     where case_id = source_case_row.id and workspace_id = case_row.workspace_id;
    snapshot := jsonb_build_object(
      'learningId', learning_row.id,
      'note', learning_row.note,
      'tags', to_jsonb(learning_row.tags),
      'sourceCaseId', source_case_row.id,
      'sourceCaseTitle', source_case_row.title,
      'applicability', nullif(array_to_string(learning_row.tags, ' · '), ''),
      'sourceOutcomeId', source_outcome_row.id,
      'evidence', nullif(trim(source_outcome_row.evidence), ''),
      'confidence', source_outcome_row.confidence,
      'nextAction', nullif(trim(source_outcome_row.next_action), ''),
      'improvements', nullif(trim(source_outcome_row.improvements), ''),
      'otherAngles', nullif(trim(source_outcome_row.other_angles), '')
    );
    snapshot_hash := encode(extensions.digest(convert_to(snapshot::text, 'UTF8'), 'sha256'), 'hex');
    insert into public.case_learning_applications(
      workspace_id, case_id, artifact_id, artifact_revision, execution_run_id,
      learning_id, source_case_id, source_outcome_id, disposition, rationale,
      learning_note_snapshot, learning_tags_snapshot, source_case_title_snapshot,
      applicability_snapshot, evidence_snapshot, confidence_snapshot,
      next_action_snapshot, improvements_snapshot, other_angles_snapshot,
      learning_snapshot_hash, applied_by
    ) values (
      case_row.workspace_id, case_row.id, artifact_id, next_revision, run_row.id,
      learning_id, source_case_row.id, source_outcome_row.id,
      lower(trim(application_item->>'disposition'))::public.learning_application_disposition,
      trim(application_item->>'rationale'), learning_row.note, learning_row.tags,
      source_case_row.title, nullif(array_to_string(learning_row.tags, ' · '), ''),
      nullif(trim(source_outcome_row.evidence), ''), source_outcome_row.confidence,
      nullif(trim(source_outcome_row.next_action), ''), nullif(trim(source_outcome_row.improvements), ''),
      nullif(trim(source_outcome_row.other_angles), ''), snapshot_hash, p_actor_id
    );
  end loop;

  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (case_row.workspace_id, p_actor_id, 'case.revision_generated', 'case', case_row.id,
      jsonb_build_object('revision', next_revision, 'stage_key', 'work_packet', 'source_count',
        (select count(*) from public.source_items where workspace_id = case_row.workspace_id and case_id = case_row.id and extraction_status = 'extracted')));
  update public.cases
     set current_revision = next_revision, status = 'awaiting_approval'
   where id = case_row.id and workspace_id = case_row.workspace_id;

  return jsonb_build_object(
    'case', jsonb_build_object('id', case_row.id, 'status', 'awaiting_approval', 'current_revision', next_revision),
    'artifact', jsonb_build_object('id', artifact_id, 'revision', next_revision, 'content_hash', computed_content_hash, 'content', p_content, 'content_locale', p_content_locale),
    'artifactRevision', next_revision,
    'artifactHash', computed_content_hash,
    'selectedLearningCount', cardinality(selected_ids)
  );
end $$;

revoke all on function public.finalize_case_work_packet(uuid, uuid, integer, uuid, jsonb, text, jsonb, jsonb, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.finalize_case_work_packet(uuid, uuid, integer, uuid, jsonb, text, jsonb, jsonb, uuid[], jsonb) to service_role;

-- Outcome reviews keep the existing required fields while retaining the exact
-- artifact/application context that was current when the outcome was recorded.
alter table public.case_outcomes add column if not exists artifact_revision integer;
alter table public.case_outcomes add column if not exists learning_application_ids uuid[] not null default '{}';

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
  current_application_ids uuid[] := '{}';
begin
  select * into case_row from public.cases where id = p_case_id for update;
  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) or case_row.status <> 'outcome_pending' then raise exception 'outcome not pending'; end if;
  if char_length(trim(coalesce(p_actual_result, ''))) = 0 or char_length(trim(coalesce(p_next_action, ''))) = 0 then raise exception 'outcome requires next action'; end if;
  if p_confidence not in ('low', 'medium', 'high') then raise exception 'invalid confidence'; end if;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into current_application_ids
    from public.case_learning_applications
   where workspace_id = case_row.workspace_id
     and case_id = case_row.id
     and artifact_revision = case_row.current_revision;
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
    current_application_ids
  ) returning id into result_id;
  insert into public.learning_records(workspace_id, case_id, disposition, note, tags, created_by)
    values (case_row.workspace_id, case_row.id, p_learning_disposition, coalesce(nullif(trim(p_learning_note), ''), p_actual_result), array[case_row.module::text], auth.uid());
  update public.cases set status = 'completed' where id = p_case_id and workspace_id = case_row.workspace_id;
  return result_id;
end $$;

-- Keep the original authenticated RPC signature and its least-privilege grant.
revoke all on function public.record_case_outcome(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text) from public, anon;
grant execute on function public.record_case_outcome(uuid, text, text, text, text, text, text, text, text, text, text, date, public.learning_disposition, text) to authenticated;
