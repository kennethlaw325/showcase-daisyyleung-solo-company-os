begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

insert into auth.users (id, email) values
  ('80000000-0000-4000-8000-000000000001', 'delete-owner@example.test'),
  ('80000000-0000-4000-8000-000000000002', 'delete-admin@example.test'),
  ('80000000-0000-4000-8000-000000000003', 'delete-member@example.test'),
  ('80000000-0000-4000-8000-000000000004', 'delete-outsider@example.test');
insert into public.workspaces (id, name, slug) values
  ('80000000-0000-4000-8000-000000000101', 'Deletion workspace', 'case-deletion-test'),
  ('80000000-0000-4000-8000-000000000102', 'Foreign workspace', 'case-deletion-foreign');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000001', 'owner'),
  ('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000002', 'admin'),
  ('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000003', 'member'),
  ('80000000-0000-4000-8000-000000000102', '80000000-0000-4000-8000-000000000004', 'owner');

insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by) values
  ('80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Delete this exact case', 'Delete graph', 'awaiting_approval', 1, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000202', '80000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Preserve this case', 'Keep graph', 'awaiting_approval', 1, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000203', '80000000-0000-4000-8000-000000000102', 'growth', 'growth', 1, 'Foreign case', 'Other tenant', 'awaiting_approval', 1, '80000000-0000-4000-8000-000000000004'),
  ('80000000-0000-4000-8000-000000000204', '80000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Executing case', 'Busy action', 'action_pending', 1, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000205', '80000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Started run case', 'Busy run', 'working', 0, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000206', '80000000-0000-4000-8000-000000000101', 'growth', 'growth', 1, 'Recent upload case', 'Busy upload', 'draft', 0, '80000000-0000-4000-8000-000000000001');

insert into public.case_artifacts (id, workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, created_by) values
  ('80000000-0000-4000-8000-000000000211', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', 1, '{"title":"Delete artifact"}', repeat('a', 64), 'en', 'growth', 1, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000212', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000202', 1, '{"title":"Preserved artifact"}', repeat('b', 64), 'en', 'growth', 1, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000214', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000204', 1, '{"title":"Executing artifact"}', repeat('c', 64), 'en', 'growth', 1, '80000000-0000-4000-8000-000000000001');
insert into public.case_actions (id, workspace_id, case_id, artifact_revision, action_type, payload, payload_hash, idempotency_key, created_by) values
  ('80000000-0000-4000-8000-000000000221', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', 1, 'gmail.create_draft', '{"to":"delete@example.test","subject":"Delete","body":"Delete"}', repeat('d', 64), 'delete-pending-action-0001', '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000224', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000204', 1, 'gmail.create_draft', '{"to":"busy@example.test","subject":"Busy","body":"Busy"}', repeat('e', 64), 'delete-executing-action-0004', '80000000-0000-4000-8000-000000000001');
insert into public.case_approvals (id, workspace_id, case_id, artifact_revision, artifact_hash, action_payload_hash, approved_by) values
  ('80000000-0000-4000-8000-000000000231', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000204', 1, repeat('c', 64), repeat('e', 64), '80000000-0000-4000-8000-000000000001');
insert into public.oauth_connections (id, workspace_id, provider, provider_account_id, secret_ref, scopes, created_by, owner_user_id, provider_account_email, mailbox_email, provider_email_verified, status)
  values ('80000000-0000-4000-8000-000000000281', '80000000-0000-4000-8000-000000000101', 'google', 'delete-google-sub', vault.create_secret('{"access_token":"delete-test"}', 'delete-test-secret'), array['https://www.googleapis.com/auth/gmail.compose'], '80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'delete-owner@example.test', 'delete-owner@example.test', true, 'active');
update public.case_actions
   set status = 'executing', execution_attempt_id = '80000000-0000-4000-8000-000000000241', execution_approval_id = '80000000-0000-4000-8000-000000000231', execution_started_at = now(), provider_message_id = '<solo-os-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee@actions.solo-company-os.invalid>', execution_actor_id = '80000000-0000-4000-8000-000000000001', execution_connection_id = '80000000-0000-4000-8000-000000000281', execution_connection_version = 1, execution_connection_email = 'delete-owner@example.test'
 where id = '80000000-0000-4000-8000-000000000224';

insert into public.execution_runs (id, workspace_id, case_id, provider, model, status, created_by) values
  ('80000000-0000-4000-8000-000000000251', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', 'gemini', 'test-model', 'succeeded', '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000252', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000202', 'gemini', 'test-model', 'succeeded', '80000000-0000-4000-8000-000000000001');

insert into public.source_items (workspace_id, case_id, source_kind, storage_path, filename, mime_type, byte_size, extraction_status, extracted_text, created_by) values
  ('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', 'private_upload', '80000000-0000-4000-8000-000000000101/80000000-0000-4000-8000-000000000201/delete.txt', 'delete.txt', 'text/plain', 10, 'extracted', 'delete source', '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000206', 'private_upload', '80000000-0000-4000-8000-000000000101/80000000-0000-4000-8000-000000000206/recent.txt', 'recent.txt', 'text/plain', 10, 'pending', null, '80000000-0000-4000-8000-000000000001');

insert into public.case_outcomes (id, workspace_id, case_id, expected_result, actual_result, evidence, confidence, what_worked, what_failed, blockers, next_action, improvements, other_angles, learning_disposition, reviewed_by, artifact_revision)
  values ('80000000-0000-4000-8000-000000000261', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', 'Expected', 'Actual', 'Evidence', 'high', 'Worked', '', '', 'Next', '', '', 'keep', '80000000-0000-4000-8000-000000000001', 1);
insert into public.learning_records (id, workspace_id, case_id, disposition, note, tags, approved_for_reuse, created_by)
  values
    ('80000000-0000-4000-8000-000000000271', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', 'keep', 'Delete learning', array['growth'], true, '80000000-0000-4000-8000-000000000001'),
    ('80000000-0000-4000-8000-000000000272', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000202', 'keep', 'Preserved learning', array['growth'], true, '80000000-0000-4000-8000-000000000001');
insert into public.case_stage_outputs (id, workspace_id, case_id, artifact_id, execution_run_id, stage_key, content_locale, output, output_hash, created_by)
  values ('80000000-0000-4000-8000-000000000281', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000211', '80000000-0000-4000-8000-000000000251', 'evidence', 'en', '{"observations":["delete"]}', repeat('f', 64), '80000000-0000-4000-8000-000000000001');
insert into public.case_learning_applications (id, workspace_id, case_id, artifact_id, artifact_revision, execution_run_id, learning_id, source_case_id, source_outcome_id, disposition, rationale, learning_note_snapshot, learning_tags_snapshot, source_case_title_snapshot, evidence_snapshot, confidence_snapshot, next_action_snapshot, learning_snapshot_hash, applied_by)
  values
    ('80000000-0000-4000-8000-000000000291', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000211', 1, '80000000-0000-4000-8000-000000000251', '80000000-0000-4000-8000-000000000271', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000261', 'applied', 'Delete rationale', 'Delete learning', array['growth'], 'Delete this exact case', 'Evidence', 'high', 'Next', repeat('1', 64), '80000000-0000-4000-8000-000000000001'),
    ('80000000-0000-4000-8000-000000000292', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000202', '80000000-0000-4000-8000-000000000212', 1, '80000000-0000-4000-8000-000000000252', '80000000-0000-4000-8000-000000000271', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000261', 'partially_applied', 'Cross case rationale', 'Delete learning', array['growth'], 'Delete this exact case', 'Evidence', 'high', 'Next', repeat('2', 64), '80000000-0000-4000-8000-000000000001');

set local role service_role;
select throws_ok($$select public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000003', 'Delete this exact case', '80000000-0000-4000-8000-000000000301')$$, 'P0001', 'case deletion unavailable', 'a member who did not create the case cannot delete it');
select throws_ok($$select public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000001', 'Wrong title', '80000000-0000-4000-8000-000000000301')$$, 'P0001', 'case deletion unavailable', 'an exact title mismatch fails closed');
select throws_ok($$select public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000203', '80000000-0000-4000-8000-000000000001', 'Foreign case', '80000000-0000-4000-8000-000000000301')$$, 'P0001', 'case deletion unavailable', 'a cross-workspace case ID fails closed');
select throws_ok($$select public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000204', '80000000-0000-4000-8000-000000000001', 'Executing case', '80000000-0000-4000-8000-000000000302')$$, 'P0001', 'case deletion is busy', 'an executing Gmail action blocks tombstoning');
select ok(public.start_case_execution_run('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000205', '80000000-0000-4000-8000-000000000001', 'gemini', 'test-model', 0) is not null, 'the service-role execution-start RPC creates a started run');
select throws_ok($$select public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000205', '80000000-0000-4000-8000-000000000001', 'Started run case', '80000000-0000-4000-8000-000000000303')$$, 'P0001', 'case deletion is busy', 'a started AI run blocks tombstoning');
select throws_ok($$select public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000206', '80000000-0000-4000-8000-000000000001', 'Recent upload case', '80000000-0000-4000-8000-000000000304')$$, 'P0001', 'case deletion is busy', 'a recent pending private upload blocks tombstoning');

select ok(public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000002', 'Delete this exact case', '80000000-0000-4000-8000-000000000301') is not null, 'a workspace admin can begin deletion');
set local role postgres;
select is((select status::text from public.cases where id = '80000000-0000-4000-8000-000000000201'), 'cancelled', 'begin atomically tombstones the case');
select is((select status::text from public.case_actions where id = '80000000-0000-4000-8000-000000000221'), 'cancelled', 'begin cancels pending actions');
select is((select approved_for_reuse from public.learning_records where id = '80000000-0000-4000-8000-000000000271'), false, 'begin disables case-derived approved learning');
select is((select deletion_request_id from public.cases where id = '80000000-0000-4000-8000-000000000201'), '80000000-0000-4000-8000-000000000301'::uuid, 'the request ID is persisted');
select is((select count(*)::integer from public.audit_events where entity_id = '80000000-0000-4000-8000-000000000201' and event_type = 'case.deletion_requested'), 1, 'begin leaves one content-free request receipt');
set local role service_role;
select is((select request_id from jsonb_to_record(public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000002', 'Delete this exact case', '80000000-0000-4000-8000-000000000301')) as x(request_id uuid)), '80000000-0000-4000-8000-000000000301'::uuid, 'the same request ID is idempotent');
select throws_ok($$select public.begin_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000002', 'Delete this exact case', '80000000-0000-4000-8000-000000000399')$$, 'P0001', 'case deletion already requested', 'a different request ID conflicts');
select throws_ok($$select public.reserve_source_upload('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000101/80000000-0000-4000-8000-000000000201/new.txt', 'new.txt', 'text/plain', 10)$$, 'P0001', 'not authorized', 'a tombstoned case cannot reserve a new upload');
select ok(public.finalize_case_deletion('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000301') is not null, 'the matching service-role finalizer hard-deletes the graph');

set local role postgres;
select is((select count(*)::integer from public.cases where id = '80000000-0000-4000-8000-000000000201'), 0, 'the deleted case row is gone');
select is((select count(*)::integer from public.case_artifacts where case_id = '80000000-0000-4000-8000-000000000201'), 0, 'case artifacts cascade');
select is((select count(*)::integer from public.case_actions where case_id = '80000000-0000-4000-8000-000000000201'), 0, 'case actions cascade');
select is((select count(*)::integer from public.case_approvals where case_id = '80000000-0000-4000-8000-000000000201'), 0, 'case approvals cascade');
select is((select count(*)::integer from public.case_outcomes where case_id = '80000000-0000-4000-8000-000000000201'), 0, 'case outcomes cascade');
select is((select count(*)::integer from public.source_items where case_id = '80000000-0000-4000-8000-000000000201'), 0, 'source rows cascade');
select is((select count(*)::integer from public.execution_runs where case_id = '80000000-0000-4000-8000-000000000201'), 0, 'execution runs cascade');
select is((select count(*)::integer from public.learning_records where case_id = '80000000-0000-4000-8000-000000000201'), 0, 'case-derived learning cascades');
select is((select count(*)::integer from public.case_stage_outputs where case_id = '80000000-0000-4000-8000-000000000201'), 0, 'stage outputs cascade');
select is((select count(*)::integer from public.case_learning_applications where id in ('80000000-0000-4000-8000-000000000291', '80000000-0000-4000-8000-000000000292')), 0, 'own and cross-case learning applications cascade');
select is((select count(*)::integer from public.cases where id = '80000000-0000-4000-8000-000000000202'), 1, 'an unrelated case is preserved');
select is((select count(*)::integer from public.case_artifacts where case_id = '80000000-0000-4000-8000-000000000202'), 1, 'the unrelated case artifact is preserved');
select is((select count(*)::integer from public.learning_records where case_id = '80000000-0000-4000-8000-000000000202'), 1, 'the unrelated case learning is preserved');
select is((select count(*)::integer from public.audit_events where entity_id = '80000000-0000-4000-8000-000000000201' and event_type = 'case.deleted'), 1, 'the content-free deletion receipt remains');

-- Direct child deletion remains forbidden while all parents exist.
insert into public.case_learning_applications (id, workspace_id, case_id, artifact_id, artifact_revision, execution_run_id, learning_id, source_case_id, disposition, rationale, learning_note_snapshot, learning_tags_snapshot, source_case_title_snapshot, learning_snapshot_hash, applied_by)
  values ('80000000-0000-4000-8000-000000000293', '80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000202', '80000000-0000-4000-8000-000000000212', 1, '80000000-0000-4000-8000-000000000252', '80000000-0000-4000-8000-000000000272', '80000000-0000-4000-8000-000000000202', 'applied', 'Keep rationale', 'Keep learning', array['growth'], 'Preserve this case', repeat('3', 64), '80000000-0000-4000-8000-000000000001');
select throws_ok($$delete from public.case_learning_applications where id = '80000000-0000-4000-8000-000000000293'$$, 'P0001', 'case work packet records are immutable', 'direct immutable child deletion is still denied');

select * from finish();
rollback;
