begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(37);

insert into auth.users (id, email) values
  ('90000000-0000-4000-8000-000000000001', 'packet-a@example.test'),
  ('90000000-0000-4000-8000-000000000002', 'packet-b@example.test');
insert into public.profiles (id, email) values
  ('90000000-0000-4000-8000-000000000001', 'packet-a@example.test'),
  ('90000000-0000-4000-8000-000000000002', 'packet-b@example.test')
on conflict (id) do update set email = excluded.email;
insert into public.workspaces (id, name, slug) values
  ('90000000-0000-4000-8000-000000000011', 'Packet A', 'packet-a-test'),
  ('90000000-0000-4000-8000-000000000022', 'Packet B', 'packet-b-test');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000001', 'owner'),
  ('90000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000002', 'owner');
insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by) values
  ('90000000-0000-4000-8000-000000000101', '90000000-0000-4000-8000-000000000011', 'growth', 'growth', 1, 'Packet A target', 'A target brief', 'draft', 0, '90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000102', '90000000-0000-4000-8000-000000000011', 'growth', 'growth', 1, 'Packet A source', 'A source brief', 'completed', 0, '90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000202', '90000000-0000-4000-8000-000000000022', 'growth', 'growth', 1, 'Packet B case', 'B brief', 'draft', 0, '90000000-0000-4000-8000-000000000002');
insert into public.case_outcomes (id, workspace_id, case_id, expected_result, actual_result, evidence, confidence, next_action, improvements, other_angles, learning_disposition, learning_note, reviewed_by) values
  ('90000000-0000-4000-8000-000000000501', '90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000102', 'Expected A', 'Actual A', 'Two approvals completed faster.', 'high', 'Repeat the boundary.', 'Add an endpoint smoke test.', 'Test the bilingual schema.', 'keep', 'Make the decision explicit.', '90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000502', '90000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000202', 'Expected B', 'Actual B', 'Tenant B evidence.', 'medium', 'Tenant B next.', '', '', 'keep', 'Tenant B learning.', '90000000-0000-4000-8000-000000000002');
insert into public.learning_records (id, workspace_id, case_id, disposition, note, tags, approved_for_reuse, created_by) values
  ('90000000-0000-4000-8000-000000000301', '90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000102', 'keep', 'Make the decision explicit.', array['approval', 'growth'], true, '90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000302', '90000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000202', 'keep', 'Tenant B learning.', array['growth'], true, '90000000-0000-4000-8000-000000000002'),
  ('90000000-0000-4000-8000-000000000303', '90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000102', 'keep', 'Unapproved learning.', array['growth'], false, '90000000-0000-4000-8000-000000000001');
insert into public.execution_runs (id, workspace_id, case_id, provider, model, status, created_by) values
  ('90000000-0000-4000-8000-000000000401', '90000000-0000-4000-8000-000000000011', '90000000-0000-4000-8000-000000000101', 'openai', 'test', 'succeeded', '90000000-0000-4000-8000-000000000001');

select ok(has_table_privilege('authenticated', 'public.case_stage_outputs', 'select'), 'authenticated members can read packet outputs through RLS');
select ok(has_table_privilege('authenticated', 'public.case_learning_applications', 'select'), 'authenticated members can read learning applications through RLS');
select ok(not has_table_privilege('authenticated', 'public.case_stage_outputs', 'insert'), 'authenticated clients cannot insert packet outputs directly');
select ok(not has_table_privilege('authenticated', 'public.case_learning_applications', 'update'), 'authenticated clients cannot update immutable applications directly');
select ok(not has_table_privilege('authenticated', 'public.case_learning_applications', 'delete'), 'authenticated clients cannot delete immutable applications directly');
select ok(not has_function_privilege('authenticated', 'public.finalize_case_work_packet(uuid,uuid,integer,uuid,jsonb,text,jsonb,jsonb,uuid[],jsonb)', 'execute'), 'authenticated clients cannot invoke finalization directly');
select ok(has_function_privilege('service_role', 'public.finalize_case_work_packet(uuid,uuid,integer,uuid,jsonb,text,jsonb,jsonb,uuid[],jsonb)', 'execute'), 'only the server role can invoke finalization');

set local role service_role;

select throws_ok(
  $$select public.finalize_case_work_packet('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 0, '90000000-0000-4000-8000-000000000401', '{"title":"Title","summary":"Summary","body":"Body","next_action":"Next"}', 'en', '[]', '{"opportunity":"Opportunity"}', array['90000000-0000-4000-8000-000000000301']::uuid[], '[{"learningId":"90000000-0000-4000-8000-000000000301","disposition":"applied","rationale":"Used"}]'::jsonb)$$,
  'P0001', 'invalid work packet envelope', 'an invalid envelope is rejected before persistence'
);
set local role postgres;
select is((select count(*) from public.case_artifacts where case_id = '90000000-0000-4000-8000-000000000101'), 0::bigint, 'invalid envelope creates no artifact rows');

set local role service_role;
select ok(
  public.finalize_case_work_packet(
    '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 0, '90000000-0000-4000-8000-000000000401',
    '{"title":"Title","summary":"Summary","body":"Body","next_action":"Next"}'::jsonb,
    'en', '{"observations":["Observed"]}', '{"opportunity":"Opportunity","hypothesis":"Hypothesis","conversionPath":"Path","proof":["Proof"],"measures":["Replies"]}',
    array['90000000-0000-4000-8000-000000000301']::uuid[],
    '[{"learningId":"90000000-0000-4000-8000-000000000301","disposition":"partially_applied","rationale":"Used the boundary."}]'::jsonb
  ) is not null,
  'a valid packet finalizes atomically'
);
set local role postgres;
select is((select current_revision from public.cases where id = '90000000-0000-4000-8000-000000000101'), 1, 'finalization advances one artifact revision');
select is((select status::text from public.cases where id = '90000000-0000-4000-8000-000000000101'), 'awaiting_approval', 'finalization keeps the existing approval gate');
select is((select count(*) from public.case_stage_outputs where case_id = '90000000-0000-4000-8000-000000000101'), 2::bigint, 'evidence and plan are supporting outputs');
select is((select count(*) from public.case_learning_applications where case_id = '90000000-0000-4000-8000-000000000101'), 1::bigint, 'one selected learning has exactly one application');
select is((select learning_note_snapshot from public.case_learning_applications where case_id = '90000000-0000-4000-8000-000000000101'), 'Make the decision explicit.', 'application stores an immutable learning note snapshot');
select is((select evidence_snapshot from public.case_learning_applications where case_id = '90000000-0000-4000-8000-000000000101'), 'Two approvals completed faster.', 'application snapshots the evidence used in the prompt');
select is((select other_angles_snapshot from public.case_learning_applications where case_id = '90000000-0000-4000-8000-000000000101'), 'Test the bilingual schema.', 'application snapshots the next test angle');
select ok((select learning_snapshot_hash ~ '^[a-f0-9]{64}$' from public.case_learning_applications where case_id = '90000000-0000-4000-8000-000000000101'), 'application stores a snapshot hash');
select is((select count(*) from public.case_stage_outputs where case_id = '90000000-0000-4000-8000-000000000101' and schema_version = 1 and content_locale = 'en'), 2::bigint, 'supporting outputs retain schema version and locale');

set local role service_role;
select throws_ok(
  $$select public.finalize_case_work_packet('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 0, '90000000-0000-4000-8000-000000000401', '{"title":"Title","summary":"Summary","body":"Body","next_action":"Next"}'::jsonb, 'en', '{"observations":[]}', '{"opportunity":"Opportunity"}', array['90000000-0000-4000-8000-000000000301']::uuid[], '[{"learningId":"90000000-0000-4000-8000-000000000301","disposition":"applied","rationale":"Used"}]'::jsonb)$$,
  'P0001', 'stale case revision', 'a stale revision is rejected under the case lock'
);
set local role postgres;
select is((select count(*) from public.case_artifacts where case_id = '90000000-0000-4000-8000-000000000101'), 1::bigint, 'stale revision leaves state unchanged');

set local role service_role;
select throws_ok(
  $$select public.finalize_case_work_packet('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 1, '90000000-0000-4000-8000-000000000401', '{"title":"Title","summary":"Summary","body":"Body","next_action":"Next"}'::jsonb, 'en', '{"observations":[]}', '{"opportunity":"Opportunity"}', array['90000000-0000-4000-8000-000000000301']::uuid[], '[{"learningId":"90000000-0000-4000-8000-000000000301","disposition":"applied","rationale":""}]'::jsonb)$$,
  'P0001', 'learning application rationale is required', 'invalid accounting rolls back before another artifact row'
);
set local role postgres;
select is((select count(*) from public.case_learning_applications where case_id = '90000000-0000-4000-8000-000000000101'), 1::bigint, 'invalid accounting creates no partial application');

set local role service_role;
select throws_ok(
  $$select public.finalize_case_work_packet('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 1, '90000000-0000-4000-8000-000000000401', '{"title":"Title","summary":"Summary","body":"Body","next_action":"Next"}'::jsonb, 'en', '{"observations":[]}', '{"opportunity":"Opportunity"}', array['90000000-0000-4000-8000-000000000302']::uuid[], '[{"learningId":"90000000-0000-4000-8000-000000000302","disposition":"applied","rationale":"Used"}]'::jsonb)$$,
  'P0001', 'selected learning is unavailable or does not match the case module', 'cross-workspace learning is rejected'
);
select throws_ok(
  $$select public.finalize_case_work_packet('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 1, '90000000-0000-4000-8000-000000000401', '{"title":"Title","summary":"Summary","body":"Body","next_action":"Next"}'::jsonb, 'en', '{"observations":[]}', '{"opportunity":"Opportunity"}', array['90000000-0000-4000-8000-000000000303']::uuid[], '[{"learningId":"90000000-0000-4000-8000-000000000303","disposition":"applied","rationale":"Used"}]'::jsonb)$$,
  'P0001', 'selected learning is unavailable or does not match the case module', 'unapproved learning is rejected'
);
set local role postgres;
select is((select count(*) from public.case_learning_applications where learning_id in ('90000000-0000-4000-8000-000000000302', '90000000-0000-4000-8000-000000000303')), 0::bigint, 'rejected learnings create no application rows');

set local role service_role;
select throws_ok(
  $$select public.finalize_case_work_packet('90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000101', 1, '90000000-0000-4000-8000-000000000401', '{"title":"Title 2","summary":"Summary","body":"Body","next_action":"Next"}'::jsonb, 'en', '{"observations":["Observed"]}', '{"opportunity":"Opportunity","hypothesis":"Hypothesis","conversionPath":"Path","proof":["Proof"],"measures":["Replies"]}', array['90000000-0000-4000-8000-000000000301']::uuid[], '[{"learningId":"90000000-0000-4000-8000-000000000301","disposition":"applied","rationale":"Used"}]'::jsonb)$$,
  '23505', 'duplicate key value violates unique constraint "stage_outputs_execution_stage_key"', 'a reused provider run fails after the attempted artifact insert'
);
set local role postgres;
select is((select count(*) from public.case_artifacts where case_id = '90000000-0000-4000-8000-000000000101'), 1::bigint, 'post-insert failure rolls back the second artifact');
select is((select current_revision from public.cases where id = '90000000-0000-4000-8000-000000000101'), 1, 'post-insert failure leaves the case revision unchanged');

set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-4000-8000-000000000002';
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}';
select results_eq($$select count(*) from public.case_learning_applications where case_id = '90000000-0000-4000-8000-000000000101'$$, array[0::bigint], 'Tenant B cannot read Tenant A learning applications');
select results_eq($$select count(*) from public.case_stage_outputs where case_id = '90000000-0000-4000-8000-000000000101'$$, array[0::bigint], 'Tenant B cannot read Tenant A stage outputs');
select results_eq($$select count(*) from public.cases where id = '90000000-0000-4000-8000-000000000101'$$, array[0::bigint], 'Tenant B cannot read Tenant A case');

set local request.jwt.claim.sub = '90000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$delete from public.case_learning_applications where case_id = '90000000-0000-4000-8000-000000000101'$$, '42501', 'permission denied for table case_learning_applications', 'authenticated members cannot delete application history');

set local role postgres;
update public.cases set status = 'outcome_pending' where id = '90000000-0000-4000-8000-000000000101';
set local role authenticated;
select ok(public.record_case_outcome('90000000-0000-4000-8000-000000000101', 'Expected', 'Actual', 'Evidence', 'medium', 'Worked', 'Failed', 'Blocked', 'Next action', 'Improve', 'Angle', current_date + 7, 'keep', 'Learning') is not null, 'outcome remains recordable after packet finalization');
select is((select artifact_revision from public.case_outcomes where case_id = '90000000-0000-4000-8000-000000000101'), 1, 'outcome binds the current artifact revision');
select is((select cardinality(learning_application_ids) from public.case_outcomes where case_id = '90000000-0000-4000-8000-000000000101'), 1, 'outcome binds current learning applications');

select results_eq($$select count(*) from public.cases where id = '90000000-0000-4000-8000-000000000202'$$, array[0::bigint], 'Tenant A cannot read Tenant B case');

select * from finish();
rollback;
