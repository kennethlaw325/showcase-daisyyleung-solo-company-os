begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_records' and column_name = 'deleted_at'),
  'learning records expose a nullable deleted_at tombstone'
);
select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_records' and column_name = 'deleted_by'),
  'learning records expose a deleted_by actor'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.learning_records'::regclass and conname = 'learning_records_deletion_fields_consistent'),
  'deletion fields have a consistent-state constraint'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'learning_records' and indexname = 'learning_records_active_workspace_created_idx'),
  'active learning rows have a workspace/created index'
);
select ok(
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'learning_records' and policyname = 'learning_member_select' and qual::text ilike '%deleted_at%'),
  'the authenticated learning select policy hides deleted rows'
);
select ok(has_table_privilege('authenticated', 'public.learning_records', 'select'), 'authenticated can read active learning through RLS');
select ok(not has_table_privilege('authenticated', 'public.learning_records', 'insert'), 'authenticated cannot insert learning rows directly');
select ok(not has_table_privilege('authenticated', 'public.learning_records', 'update'), 'authenticated cannot update learning rows directly');
select ok(not has_table_privilege('authenticated', 'public.learning_records', 'delete'), 'authenticated cannot delete learning rows directly');
select ok(has_function_privilege('authenticated', 'public.delete_learning_signal(uuid)', 'execute'), 'authenticated can invoke the bounded delete RPC');
select ok(not has_function_privilege('anon', 'public.delete_learning_signal(uuid)', 'execute'), 'anon cannot invoke the delete RPC');
select ok(not has_function_privilege('service_role', 'public.delete_learning_signal(uuid)', 'execute'), 'service role cannot invoke the delete RPC directly');

insert into auth.users (id, email) values
  ('a1200000-0000-4000-8000-000000000001', 'learning-owner@example.test'),
  ('a1200000-0000-4000-8000-000000000002', 'learning-admin@example.test'),
  ('a1200000-0000-4000-8000-000000000003', 'learning-member@example.test'),
  ('b1200000-0000-4000-8000-000000000004', 'learning-foreign@example.test');
insert into public.workspaces (id, name, slug) values
  ('a1200000-0000-4000-8000-000000000101', 'Learning A', 'learning-deletion-a'),
  ('b1200000-0000-4000-8000-000000000102', 'Learning B', 'learning-deletion-b');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000001', 'owner'),
  ('a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000002', 'admin'),
  ('a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000003', 'member'),
  ('b1200000-0000-4000-8000-000000000102', 'b1200000-0000-4000-8000-000000000004', 'owner');

insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by) values
  ('a1200000-0000-4000-8000-000000000201', 'a1200000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Learning source case', 'A learning source', 'draft', 0, 'a1200000-0000-4000-8000-000000000001'),
  ('b1200000-0000-4000-8000-000000000202', 'b1200000-0000-4000-8000-000000000102', 'growth', 'growth', 1, 'Foreign learning case', 'A foreign learning source', 'draft', 0, 'b1200000-0000-4000-8000-000000000004');
insert into public.case_outcomes (id, workspace_id, case_id, expected_result, actual_result, evidence, confidence, next_action, learning_disposition, learning_note, reviewed_by)
  values ('a1200000-0000-4000-8000-000000000401', 'a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000201', 'Expected', 'Actual', 'Evidence', 'high', 'Next action', 'keep', 'Owner learning', 'a1200000-0000-4000-8000-000000000001');
insert into public.case_artifacts (id, workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, created_by)
  values ('a1200000-0000-4000-8000-000000000211', 'a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000201', 1, '{"title":"Learning artifact"}', repeat('a', 64), 'en', 'growth', 1, 'a1200000-0000-4000-8000-000000000001');
insert into public.execution_runs (id, workspace_id, case_id, provider, model, status, created_by)
  values ('a1200000-0000-4000-8000-000000000251', 'a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000201', 'openai', 'test-model', 'succeeded', 'a1200000-0000-4000-8000-000000000001');
insert into public.learning_records (id, workspace_id, case_id, disposition, note, tags, approved_for_reuse, created_by)
  values
    ('a1200000-0000-4000-8000-000000000301', 'a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000201', 'keep', 'Owner learning', array['growth'], true, 'a1200000-0000-4000-8000-000000000001'),
    ('a1200000-0000-4000-8000-000000000302', 'a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000201', 'adapt', 'Member learning', array['growth'], true, 'a1200000-0000-4000-8000-000000000003'),
    ('b1200000-0000-4000-8000-000000000303', 'b1200000-0000-4000-8000-000000000102', 'b1200000-0000-4000-8000-000000000202', 'keep', 'Foreign learning', array['growth'], true, 'b1200000-0000-4000-8000-000000000004');
insert into public.case_learning_applications (
  id, workspace_id, case_id, artifact_id, artifact_revision, execution_run_id,
  learning_id, source_case_id, source_outcome_id, disposition, rationale,
  learning_note_snapshot, learning_tags_snapshot, source_case_title_snapshot,
  evidence_snapshot, confidence_snapshot, next_action_snapshot,
  learning_snapshot_hash, applied_by
) values (
  'a1200000-0000-4000-8000-000000000291', 'a1200000-0000-4000-8000-000000000101', 'a1200000-0000-4000-8000-000000000201',
  'a1200000-0000-4000-8000-000000000211', 1, 'a1200000-0000-4000-8000-000000000251',
  'a1200000-0000-4000-8000-000000000301', 'a1200000-0000-4000-8000-000000000201', 'a1200000-0000-4000-8000-000000000401',
  'applied', 'Used the learning', 'Owner learning', array['growth'], 'Learning source case',
  'Evidence', 'high', 'Next action', repeat('1', 64), 'a1200000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a1200000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"a1200000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$select count(*) from public.learning_records$$, array[2::bigint], 'a workspace owner sees only active same-workspace learning');
select is(public.delete_learning_signal('a1200000-0000-4000-8000-000000000301'), true, 'the learning creator can delete their own signal');

set local role postgres;
select ok((select deleted_at is not null from public.learning_records where id = 'a1200000-0000-4000-8000-000000000301'), 'deletion stores a tombstone timestamp');
select is((select deleted_by from public.learning_records where id = 'a1200000-0000-4000-8000-000000000301'), 'a1200000-0000-4000-8000-000000000001'::uuid, 'deletion stores the verified actor');
select is((select approved_for_reuse from public.learning_records where id = 'a1200000-0000-4000-8000-000000000301'), false, 'deletion clears approval');
select is((select count(*)::integer from public.case_learning_applications where learning_id = 'a1200000-0000-4000-8000-000000000301'), 1, 'immutable applied-learning history remains');
select is((select count(*)::integer from public.audit_events where event_type = 'learning.deleted' and entity_id = 'a1200000-0000-4000-8000-000000000301'), 1, 'the first delete writes exactly one audit event');
select is((select metadata from public.audit_events where event_type = 'learning.deleted' and entity_id = 'a1200000-0000-4000-8000-000000000301' limit 1), '{}'::jsonb, 'the deletion audit is content-free');

set local role authenticated;
set local request.jwt.claim.sub = 'a1200000-0000-4000-8000-000000000001';
select is(public.delete_learning_signal('a1200000-0000-4000-8000-000000000301'), true, 'an authorized repeated delete is idempotent');
set local role postgres;
select is((select count(*)::integer from public.audit_events where event_type = 'learning.deleted' and entity_id = 'a1200000-0000-4000-8000-000000000301'), 1, 'an idempotent retry writes no second audit');

set local role authenticated;
select is(public.confirm_learning_for_reuse('a1200000-0000-4000-8000-000000000301'), false, 'a deleted learning cannot be confirmed');
select results_eq($$select count(*) from public.learning_records where id = 'a1200000-0000-4000-8000-000000000301'$$, array[0::bigint], 'RLS hides the deleted learning from active reads');
set local role service_role;
select throws_ok($$select public.finalize_case_work_packet('a1200000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000201', 0, 'a1200000-0000-4000-8000-000000000251', '{"title":"Title","summary":"Summary","body":"Body","next_action":"Next"}'::jsonb, 'en', '{"observations":[]}'::jsonb, '{"opportunity":"Opportunity"}'::jsonb, array['a1200000-0000-4000-8000-000000000301']::uuid[], '[{"learningId":"a1200000-0000-4000-8000-000000000301","disposition":"applied","rationale":"Used"}]'::jsonb)$$, 'P0001', 'selected learning is unavailable or does not match the case module', 'finalization rejects a deleted learning');

set local role authenticated;
set local request.jwt.claim.sub = 'a1200000-0000-4000-8000-000000000003';
select is(public.delete_learning_signal('a1200000-0000-4000-8000-000000000301'), false, 'a same-workspace member cannot delete another user learning');
set local request.jwt.claim.sub = 'a1200000-0000-4000-8000-000000000002';
select is(public.delete_learning_signal('a1200000-0000-4000-8000-000000000302'), true, 'a workspace admin can delete another user learning');
set local request.jwt.claim.sub = 'b1200000-0000-4000-8000-000000000004';
select is(public.delete_learning_signal('a1200000-0000-4000-8000-000000000302'), false, 'cross-workspace learning deletion is opaque');

set local role postgres;
select is((select count(*)::integer from public.learning_records where workspace_id = 'a1200000-0000-4000-8000-000000000101' and deleted_at is null), 0, 'all deleted learning is absent from active workspace rows');
select ok((select deleted_at is not null from public.learning_records where id = 'a1200000-0000-4000-8000-000000000302'), 'admin deletion also writes a tombstone');
select is((select count(*)::integer from public.learning_records where id = 'b1200000-0000-4000-8000-000000000303'), 1, 'foreign learning remains isolated');
select is((select count(*)::integer from public.audit_events where event_type = 'learning.deleted' and entity_id = 'a1200000-0000-4000-8000-000000000302'), 1, 'admin deletion writes one audit event');

select * from finish();
rollback;
