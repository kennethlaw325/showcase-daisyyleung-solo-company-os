begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

insert into auth.users (id, email) values ('30000000-0000-4000-8000-000000000003', 'approval@example.test');
insert into public.workspaces (id, name, slug) values ('c0000000-0000-4000-8000-000000000003', 'Approval workspace', 'approval-workspace-test');
insert into public.workspace_members (workspace_id, user_id, role) values ('c0000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'owner');
insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by)
  values ('cc000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 'growth', 'growth', 1, 'Approval case', 'Approval brief', 'awaiting_approval', 1, '30000000-0000-4000-8000-000000000003');
insert into public.case_artifacts (workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, created_by)
  values ('c0000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000003', 1, '{"title":"Approved"}', repeat('a', 64), 'en', 'growth', 1, '30000000-0000-4000-8000-000000000003');
insert into public.workspaces (id, name, slug) values ('c0000000-0000-4000-8000-000000000013', 'Approval cross-workspace', 'approval-cross-workspace-test');
insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by)
  values ('cc000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000013', 'operations', 'operations', 1, 'Cross-workspace artifact case', 'Cross-workspace artifact brief', 'draft', 1, '30000000-0000-4000-8000-000000000003');
insert into public.case_artifacts (workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, created_by)
  values ('c0000000-0000-4000-8000-000000000013', 'cc000000-0000-4000-8000-000000000013', 2, '{"title":"Foreign artifact"}', repeat('d', 64), 'en', 'operations', 1, '30000000-0000-4000-8000-000000000003');

select throws_ok(
  $$insert into public.case_actions (id, workspace_id, case_id, artifact_revision, action_type, payload, payload_hash, idempotency_key, created_by)
    values ('ac000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000003', 2, 'gmail.create_draft', '{"to":"foreign@example.test","subject":"Foreign","body":"Foreign"}', repeat('e', 64), 'approval-cross-workspace-action-0013', '30000000-0000-4000-8000-000000000003')$$,
  '23503',
  'insert or update on table "case_actions" violates foreign key constraint "actions_workspace_artifact_revision_fk"',
  'a case action cannot reference an artifact revision from another workspace or case'
);
select throws_ok(
  $$insert into public.case_approvals (id, workspace_id, case_id, artifact_revision, artifact_hash, action_payload_hash, approved_by)
    values ('aa000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000003', 2, repeat('f', 64), repeat('e', 64), '30000000-0000-4000-8000-000000000003')$$,
  '23503',
  'insert or update on table "case_approvals" violates foreign key constraint "approvals_workspace_artifact_revision_fk"',
  'an approval cannot reference an artifact revision from another workspace or case'
);

insert into public.case_actions (id, workspace_id, case_id, artifact_revision, action_type, payload, payload_hash, idempotency_key, created_by)
  values ('ac000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000003', 1, 'gmail.create_draft', '{"to":"approved@example.test","subject":"Approved","body":"Approved"}', repeat('b', 64), 'approval-idempotency-0003', '30000000-0000-4000-8000-000000000003');
insert into public.oauth_connections (id, workspace_id, provider, provider_account_id, secret_ref, scopes, created_by, owner_user_id, provider_account_email, mailbox_email, status)
  values ('ac000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000003', 'google', 'google-approval-sub', vault.create_secret('{"access_token":"approval-token"}', 'approval-oauth-secret'), array['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'], '30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'approval@example.test', 'approval@example.test', 'active');

set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-4000-8000-000000000003';
set local request.jwt.claims = '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select public.approve_case_action('cc000000-0000-4000-8000-000000000003', 1, repeat('c', 64), repeat('b', 64))$$,
  'P0001', 'stale artifact', 'a changed artifact hash cannot be approved'
);
select throws_ok(
  $$select public.approve_case_action('cc000000-0000-4000-8000-000000000003', 1, repeat('a', 64), repeat('c', 64))$$,
  'P0001', 'stale action', 'a changed action payload hash cannot be approved'
);
select ok(
  public.approve_case_action('cc000000-0000-4000-8000-000000000003', 1, repeat('a', 64), repeat('b', 64)) is not null,
  'the exact artifact and payload can be approved'
);
select is((select status::text from public.cases where id = 'cc000000-0000-4000-8000-000000000003'), 'action_pending', 'approval advances the case to action_pending');

select ok(not has_function_privilege('authenticated', 'public.claim_case_action_attempt(uuid,text,text,uuid,uuid)', 'execute'), 'browser sessions cannot call the explicit-actor claim RPC');
set local role service_role;

select ok(
  set_config(
    'test.execution_attempt_id',
    public.claim_case_action_attempt(
      'ac000000-0000-4000-8000-000000000003',
      'approval-idempotency-0003',
      '<solo-os-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@actions.solo-company-os.invalid>',
      'ac000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003'
    )::text,
    true
  )::uuid is not null,
  'the first exact claim creates a durable execution attempt'
);
select is(
  public.claim_case_action_attempt(
    'ac000000-0000-4000-8000-000000000003',
    'approval-idempotency-0003',
    '<solo-os-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@actions.solo-company-os.invalid>',
    'ac000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000003'
  ),
  null::uuid,
  'a repeated claim cannot start a second provider action'
);
set local role postgres;
select ok(
  (select execution_approval_id is not null and provider_message_id is not null from public.case_actions where id = 'ac000000-0000-4000-8000-000000000003'),
  'the execution attempt is bound to its exact approval and provider marker'
);
select is(
  public.mark_case_action_executed_attempt(
    'ac000000-0000-4000-8000-000000000003',
    '99999999-9999-4999-8999-999999999999',
    'draft-wrong',
    '<solo-os-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@actions.solo-company-os.invalid>',
    '30000000-0000-4000-8000-000000000003',
    false
  ),
  false,
  'a mismatched attempt cannot finalize provider success'
);
select is(
  public.record_case_action_reconciliation_check('ac000000-0000-4000-8000-000000000003', current_setting('test.execution_attempt_id')::uuid, '30000000-0000-4000-8000-000000000003'),
  true,
  'the matching attempt can record a content-free reconciliation check'
);
select ok((select reconciliation_checked_at is not null from public.case_actions where id = 'ac000000-0000-4000-8000-000000000003'), 'the reconciliation timestamp is durable');
select is(
  public.mark_case_action_executed_attempt(
    'ac000000-0000-4000-8000-000000000003',
    current_setting('test.execution_attempt_id')::uuid,
    'draft-verified',
    '<solo-os-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@actions.solo-company-os.invalid>',
    '30000000-0000-4000-8000-000000000003',
    true
  ),
  true,
  'the matching attempt can finalize a reconciled draft'
);
select ok((select status = 'executed' and provider_reference = 'draft-verified' from public.case_actions where id = 'ac000000-0000-4000-8000-000000000003'), 'the action records one provider result');
select is((select status::text from public.cases where id = 'cc000000-0000-4000-8000-000000000003'), 'outcome_pending', 'provider success advances the case to outcome_pending');
select ok(not has_function_privilege('authenticated', 'public.claim_case_action(uuid,text)', 'execute'), 'the legacy claim RPC is retired');
select ok(not has_function_privilege('authenticated', 'public.mark_case_action_executed(uuid,text)', 'execute'), 'the legacy finalize RPC is retired');

select * from finish();
rollback;
