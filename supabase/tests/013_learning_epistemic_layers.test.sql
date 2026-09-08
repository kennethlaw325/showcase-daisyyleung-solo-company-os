begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(42);

insert into auth.users (id, email) values
  ('13000000-0000-4000-8000-000000000001', 'learning-a@example.test'),
  ('13000000-0000-4000-8000-000000000002', 'learning-b@example.test');
insert into public.workspaces (id, name, slug) values
  ('13000000-0000-4000-8000-000000000101', 'Learning A', 'learning-epistemic-a'),
  ('13000000-0000-4000-8000-000000000102', 'Learning B', 'learning-epistemic-b');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000001', 'owner'),
  ('13000000-0000-4000-8000-000000000102', '13000000-0000-4000-8000-000000000002', 'owner');

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'case_artifacts' and column_name = 'work_packet_source_artifact_id'),
  'case artifacts expose additive packet lineage'
);
select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_records' and column_name = 'applicability')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_records' and column_name = 'supporting_outcome_count')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_records' and column_name = 'learning_confidence')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_records' and column_name = 'validation_status'),
  'learning records expose separated epistemic columns'
);
select ok(
  has_table_privilege('service_role', 'public.learning_records', 'select')
    and has_table_privilege('service_role', 'public.learning_records', 'update')
    and not has_table_privilege('authenticated', 'public.learning_records', 'update'),
  'only the private service role can bind an adapted candidate row'
);
select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'case_learning_applications' and column_name = 'supporting_outcome_count_snapshot')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'case_learning_applications' and column_name = 'learning_confidence_snapshot')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'case_learning_applications' and column_name = 'validation_status_snapshot'),
  'applications snapshot epistemic fields'
);

insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by) values
  ('13000000-0000-4000-8000-000000000201', '13000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Packet source', 'Packet source brief', 'awaiting_approval', 1, '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000202', '13000000-0000-4000-8000-000000000102', 'growth', 'growth', 1, 'Foreign packet', 'Foreign packet brief', 'awaiting_approval', 1, '13000000-0000-4000-8000-000000000002'),
  ('13000000-0000-4000-8000-000000000211', '13000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Keep outcome', 'Keep outcome brief', 'outcome_pending', 1, '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000212', '13000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Adapt outcome', 'Adapt outcome brief', 'outcome_pending', 1, '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000213', '13000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Discard outcome', 'Discard outcome brief', 'outcome_pending', 1, '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000214', '13000000-0000-4000-8000-000000000102', 'growth', 'growth', 1, 'Foreign outcome', 'Foreign outcome brief', 'outcome_pending', 1, '13000000-0000-4000-8000-000000000002'),
  ('13000000-0000-4000-8000-000000000216', '13000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Invalid adapt', 'Invalid adapt brief', 'outcome_pending', 1, '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000217', '13000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Legacy adapt', 'Legacy adapt brief', 'outcome_pending', 1, '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000218', '13000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Legacy keep', 'Legacy keep brief', 'outcome_pending', 1, '13000000-0000-4000-8000-000000000001');
insert into public.case_artifacts (id, workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, work_packet_source_artifact_id, created_by) values
  ('13000000-0000-4000-8000-000000000301', '13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000201', 1, '{"title":"Packet"}', repeat('a', 64), 'en', 'growth', 1, '13000000-0000-4000-8000-000000000301', '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000302', '13000000-0000-4000-8000-000000000102', '13000000-0000-4000-8000-000000000202', 1, '{"title":"Foreign packet"}', repeat('b', 64), 'en', 'growth', 1, '13000000-0000-4000-8000-000000000302', '13000000-0000-4000-8000-000000000002');
insert into public.learning_records (id, workspace_id, case_id, disposition, note, tags, created_by) values
  ('13000000-0000-4000-8000-000000000303', '13000000-0000-4000-8000-000000000102', '13000000-0000-4000-8000-000000000214', 'keep', 'Historical unassessed note', array['growth'], '13000000-0000-4000-8000-000000000002');
insert into public.execution_runs (id, workspace_id, case_id, provider, model, status, created_by) values
  ('13000000-0000-4000-8000-000000000401', '13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000201', 'gemini', 'test-model', 'succeeded', '13000000-0000-4000-8000-000000000001');
insert into public.case_stage_outputs (id, workspace_id, case_id, artifact_id, execution_run_id, stage_key, content_locale, output, output_hash, created_by) values
  ('13000000-0000-4000-8000-000000000411', '13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000201', '13000000-0000-4000-8000-000000000301', '13000000-0000-4000-8000-000000000401', 'evidence', 'en', '{"observations":["Observed"]}', repeat('c', 64), '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000412', '13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000201', '13000000-0000-4000-8000-000000000301', '13000000-0000-4000-8000-000000000401', 'plan', 'en', '{"opportunity":"Opportunity"}', repeat('d', 64), '13000000-0000-4000-8000-000000000001');
insert into public.case_actions (id, workspace_id, case_id, artifact_revision, action_type, payload, payload_hash, idempotency_key, created_by) values
  ('13000000-0000-4000-8000-000000000421', '13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000201', 1, 'gmail.create_draft', '{"to":"packet@example.test","subject":"Packet","body":"Packet"}', repeat('e', 64), 'learning-packet-action-0001', '13000000-0000-4000-8000-000000000001');

select throws_ok(
  $$insert into public.case_artifacts (workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, work_packet_source_artifact_id, created_by)
      values ('13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000201', 9, '{"title":"Cross tenant"}', repeat('f', 64), 'en', 'growth', 1, '13000000-0000-4000-8000-000000000302', '13000000-0000-4000-8000-000000000001')$$,
  '23503', null, 'cross-workspace packet lineage is rejected by the composite foreign key'
);
select ok(
  exists (select 1 from pg_constraint where conname = 'artifacts_workspace_case_lineage_fk' and conrelid = 'public.case_artifacts'::regclass),
  'packet lineage uses an explicit tenant-safe self foreign key'
);
select ok(
  exists (select 1 from pg_trigger where tgname = 'case_artifacts_work_packet_lineage_immutable' and tgrelid = 'public.case_artifacts'::regclass),
  'packet lineage has an immutable update trigger'
);
select ok(
  (select learning_confidence is null and validation_status is null and supporting_outcome_count is null
     from public.learning_records where id = '13000000-0000-4000-8000-000000000303'),
  'historical learning remains null and unassessed'
);

set local role authenticated;
set local request.jwt.claim.sub = '13000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"13000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(
  public.create_case_revision('13000000-0000-4000-8000-000000000201', 1, '{"title":"Packet edit","summary":"Summary","body":"Body","next_action":"Next"}', 'en', '{"to":"packet@example.test","subject":"Packet edit","body":"Packet edit"}') is not null,
  'human revision RPC creates an editable artifact'
);
select is((select work_packet_source_artifact_id from public.case_artifacts where case_id = '13000000-0000-4000-8000-000000000201' and revision = 2), '13000000-0000-4000-8000-000000000301'::uuid, 'human edits inherit the resolved packet source artifact');

select ok(
  public.record_case_outcome_review('13000000-0000-4000-8000-000000000211', 'Expected', 'Actual keep', 'Observed keep', 'high', 'Worked', 'Failed', 'Blocked', 'Next keep', 'Improve', 'Angle', current_date + 7, 'keep', 'Keep candidate', 'Sales → Warm lead → Budget not confirmed', false)->>'outcomeId' is not null,
  'keep records the outcome and candidate'
);
select is((select supporting_outcome_count from public.learning_records where case_id = '13000000-0000-4000-8000-000000000211'), 1, 'keep starts with one supporting outcome');
select is((select learning_confidence from public.learning_records where case_id = '13000000-0000-4000-8000-000000000211'), 'low', 'keep starts with low learning confidence');
select is((select validation_status from public.learning_records where case_id = '13000000-0000-4000-8000-000000000211'), 'pending_validation', 'keep starts pending validation');
select is((select approved_for_reuse from public.learning_records where case_id = '13000000-0000-4000-8000-000000000211'), false, 'keep candidate is not approved for reuse');
select is((select applicability from public.learning_records where case_id = '13000000-0000-4000-8000-000000000211'), 'Sales → Warm lead → Budget not confirmed', 'keep preserves exact applicability');
select is((select status::text from public.cases where id = '13000000-0000-4000-8000-000000000211'), 'completed', 'keep completes the case atomically');

select ok(
  (public.record_case_outcome_review('13000000-0000-4000-8000-000000000212', 'Expected', 'Actual adapt', 'Observed adapt', 'medium', 'Worked', 'Failed', 'Blocked', 'Next adapt', 'Improve', 'Angle', current_date + 7, 'adapt', 'Adapted exact candidate', 'Sales → Warm lead → Budget not confirmed', true)->>'learningApproval') = 'approved_for_reuse',
  'adapt records and explicitly approves the exact candidate atomically'
);
select is((select applicability from public.learning_records where case_id = '13000000-0000-4000-8000-000000000212'), 'Sales → Warm lead → Budget not confirmed', 'adapt stores the exact narrow applicability');
select is((select approved_for_reuse from public.learning_records where case_id = '13000000-0000-4000-8000-000000000212'), true, 'adapt can explicitly approve the exact candidate');
select is((select validation_status from public.learning_records where case_id = '13000000-0000-4000-8000-000000000212'), 'pending_validation', 'adapt approval does not validate evidence');

select ok(
  (public.record_case_outcome_review('13000000-0000-4000-8000-000000000213', 'Expected', 'Actual discard', 'Observed discard', 'low', 'Worked', 'Failed', 'Blocked', 'Next discard', 'Improve', 'Angle', current_date + 7, 'discard', null, null, false)->>'learningGenerated') = 'false',
  'discard records the outcome without creating learning'
);
select is((select count(*)::integer from public.learning_records where case_id = '13000000-0000-4000-8000-000000000213'), 0, 'discard records the outcome without a learning row');

select throws_ok(
  $$select public.record_case_outcome_review('13000000-0000-4000-8000-000000000216', 'Expected', 'Actual invalid', 'Observed invalid', 'low', 'Worked', 'Failed', 'Blocked', 'Next invalid', 'Improve', 'Angle', current_date + 7, 'adapt', 'Exact candidate', null, false)$$,
  'P0001', 'adapted learning requires exact candidate, applicability, and confirmation',
  'invalid adapt is rejected before any outcome, learning, audit, or completion write'
);
select is((select status::text from public.cases where id = '13000000-0000-4000-8000-000000000216'), 'outcome_pending', 'invalid adapt leaves the case pending');
select is((select count(*)::integer from public.case_outcomes where case_id = '13000000-0000-4000-8000-000000000216'), 0, 'invalid adapt leaves no outcome row');
select is((select count(*)::integer from public.learning_records where case_id = '13000000-0000-4000-8000-000000000216'), 0, 'invalid adapt leaves no learning row');
select is((select count(*)::integer from public.audit_events where entity_id = '13000000-0000-4000-8000-000000000216'), 0, 'invalid adapt leaves no audit receipt');
select ok(
  (public.record_case_outcome_review('13000000-0000-4000-8000-000000000216', 'Expected', 'Actual valid', 'Observed valid', 'low', 'Worked', 'Failed', 'Blocked', 'Next valid', 'Improve', 'Angle', current_date + 7, 'adapt', 'Exact candidate', 'Exact applicability', true)->>'completed') = 'true',
  'a valid retry can complete the case after the rejected adapt'
);
select throws_ok(
  $$select public.record_case_outcome_review('13000000-0000-4000-8000-000000000216', 'Expected', 'Duplicate', 'Duplicate', 'low', 'Worked', 'Failed', 'Blocked', 'Next duplicate', 'Improve', 'Angle', current_date + 7, 'discard', null, null, false)$$,
  'P0001', 'outcome not pending',
  'duplicate or stale retry is rejected after completion'
);

select throws_ok(
  $$select public.record_case_outcome('13000000-0000-4000-8000-000000000217', 'Expected', 'Legacy adapt', 'Observed', 'low', 'Worked', 'Failed', 'Blocked', 'Next', 'Improve', 'Angle', current_date + 7, 'adapt', 'Legacy candidate')$$,
  'P0001', 'legacy outcome adaptation requires upgraded client',
  'the legacy signature cannot bypass exact adapted-learning approval'
);
select is((select status::text from public.cases where id = '13000000-0000-4000-8000-000000000217'), 'outcome_pending', 'rejected legacy adapt leaves the case pending');
select is((select count(*)::integer from public.case_outcomes where case_id = '13000000-0000-4000-8000-000000000217'), 0, 'rejected legacy adapt leaves no outcome');

select ok(
  public.record_case_outcome('13000000-0000-4000-8000-000000000218', 'Expected', 'Legacy keep', 'Observed', 'low', 'Worked', 'Failed', 'Blocked', 'Next', 'Improve', 'Angle', current_date + 7, 'keep', 'Legacy candidate') is not null,
  'the constrained legacy signature can complete a rollback-era keep outcome'
);
select is((select count(*)::integer from public.learning_records where case_id = '13000000-0000-4000-8000-000000000218'), 0, 'legacy keep cannot create learning without applicability');
select is((select status::text from public.cases where id = '13000000-0000-4000-8000-000000000218'), 'completed', 'legacy keep completes the case through the atomic kernel');
select is((select count(*)::integer from public.audit_events where entity_id = '13000000-0000-4000-8000-000000000218' and event_type = 'outcome_recorded'), 1, 'legacy keep still writes the required content-free audit receipt');

set local role postgres;
select throws_ok(
  $$delete from public.case_artifacts where id = '13000000-0000-4000-8000-000000000301'$$,
  '23503', null,
  'deleting a packet source cannot cascade ordinary artifact history'
);
select throws_ok(
  $$update public.case_artifacts set work_packet_source_artifact_id = null where id = '13000000-0000-4000-8000-000000000301'$$,
  'P0001', 'work packet lineage is immutable',
  'packet lineage cannot be rewritten after creation'
);
set local role authenticated;

select throws_ok(
  $$select public.record_case_outcome_review('13000000-0000-4000-8000-000000000214', 'Expected', 'Foreign actual', 'Foreign evidence', 'low', 'Worked', 'Failed', 'Blocked', 'Next', 'Improve', 'Angle', current_date + 7, 'keep', 'Cross tenant', 'Foreign applicability', false)$$,
  'P0001', 'outcome not authorized', 'cross-workspace outcome recording is rejected'
);

set local role postgres;
insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by)
  values ('13000000-0000-4000-8000-000000000215', '13000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Lineage deletion', 'Lineage deletion brief', 'cancelled', 2, '13000000-0000-4000-8000-000000000001');
insert into public.case_artifacts (id, workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, work_packet_source_artifact_id, created_by) values
  ('13000000-0000-4000-8000-000000000305', '13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000215', 1, '{"title":"Packet source"}', repeat('5', 64), 'en', 'growth', 1, '13000000-0000-4000-8000-000000000305', '13000000-0000-4000-8000-000000000001'),
  ('13000000-0000-4000-8000-000000000306', '13000000-0000-4000-8000-000000000101', '13000000-0000-4000-8000-000000000215', 2, '{"title":"Inherited edit"}', repeat('6', 64), 'en', 'growth', 1, '13000000-0000-4000-8000-000000000305', '13000000-0000-4000-8000-000000000001');
select lives_ok(
  $$delete from public.cases where id = '13000000-0000-4000-8000-000000000215'$$,
  'case deletion still cascades through self and inherited packet lineage'
);
select is(
  (select count(*)::integer from public.case_artifacts where case_id = '13000000-0000-4000-8000-000000000215'),
  0,
  'case deletion removes every lineage-linked artifact'
);

select * from finish();
rollback;
