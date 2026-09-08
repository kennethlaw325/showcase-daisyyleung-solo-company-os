begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(29);

insert into auth.users (id, email) values ('66000000-0000-4000-8000-000000000006', 'revision-owner@example.test');
insert into public.workspaces (id, name, slug) values ('66000000-0000-4000-8000-000000000066', 'Revision workspace', 'revision-edit-test');
insert into public.workspace_members (workspace_id, user_id, role) values ('66000000-0000-4000-8000-000000000066', '66000000-0000-4000-8000-000000000006', 'owner');
insert into auth.users (id, email) values ('66000000-0000-0000-0000-000000000007', 'revision-outsider@example.test');
insert into public.workspaces (id, name, slug) values ('66000000-0000-0000-0000-000000000067', 'Other workspace', 'revision-other-test');
insert into public.workspace_members (workspace_id, user_id, role) values ('66000000-0000-0000-0000-000000000067', '66000000-0000-0000-0000-000000000007', 'owner');
insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by)
  values ('66000000-0000-4000-8000-000000000606', '66000000-0000-4000-8000-000000000066', 'growth', 'growth', 1, 'Revision case', 'Revision brief', 'awaiting_approval', 1, '66000000-0000-4000-8000-000000000006');
insert into public.case_artifacts (workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, created_by)
  values ('66000000-0000-4000-8000-000000000066', '66000000-0000-4000-8000-000000000606', 1, '{"title":"Draft 1","summary":"Summary 1","body":"Body 1","next_action":"Next 1"}', repeat('a', 64), 'en', 'growth', 1, '66000000-0000-4000-8000-000000000006');
insert into public.case_actions (id, workspace_id, case_id, artifact_revision, action_type, payload, payload_hash, idempotency_key, created_by)
  values ('66000000-0000-4000-8000-000000000616', '66000000-0000-4000-8000-000000000066', '66000000-0000-4000-8000-000000000606', 1, 'gmail.create_draft', '{"to":"old@example.test","subject":"Old subject","body":"Old body"}', repeat('b', 64), 'revision-old-action-0006', '66000000-0000-4000-8000-000000000006');
insert into public.oauth_connections (id, workspace_id, provider, provider_account_id, secret_ref, scopes, created_by, owner_user_id, provider_account_email, mailbox_email, status)
  values ('66000000-0000-4000-8000-000000000617', '66000000-0000-4000-8000-000000000066', 'google', 'google-revision-sub', vault.create_secret('{"access_token":"revision-token"}', 'revision-oauth-secret'), array['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'], '66000000-0000-4000-8000-000000000006', '66000000-0000-4000-8000-000000000006', 'revision-owner@example.test', 'revision-owner@example.test', 'active');

select ok(not has_function_privilege('anon', 'public.create_case_revision(uuid,integer,jsonb,text,jsonb)', 'execute'), 'anonymous clients cannot create revisions');

set local role authenticated;
set local request.jwt.claim.sub = '66000000-0000-4000-8000-000000000006';
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 0, '{"title":"Draft 0","summary":"Summary","body":"Body","next_action":"Next"}', 'en', '{"to":"new@example.test","subject":"New","body":"New body"}')$$,
  'P0001', 'stale case revision', 'a stale expected revision is rejected under the case lock'
);
select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 1, '{"title":"Draft 1","summary":"Summary 1","body":"Body 1","next_action":"Next 1"}', 'en', '{"to":"old@example.test","subject":"Old subject","body":"Old body"}')$$,
  'P0001', 'no changes to save', 'an unchanged artifact and payload are rejected as a no-op'
);
select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 1, '{"title":"Draft 2","summary":"Summary 2","body":"Body 2","next_action":"Next 2","hidden":"should reject"}', 'en', '{"to":"new@example.test","subject":"New subject","body":"New body"}')$$,
  'P0001', 'invalid revision content', 'unknown artifact content keys are rejected'
);
select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 1, '{"title":"Draft 2","summary":"Summary 2","body":"Body 2","next_action":"Next 2"}', 'en', '{"to":"new@example.test","subject":"New subject","body":"New body","hidden":"should reject"}')$$,
  'P0001', 'invalid action payload', 'unknown action payload keys are rejected'
);
select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 1, '{"title":42,"summary":"Summary 2","body":"Body 2","next_action":"Next 2"}', 'en', '{"to":"new@example.test","subject":"New subject","body":"New body"}')$$,
  'P0001', 'invalid revision content', 'non-string artifact content is rejected'
);
select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 1, '{"title":"Draft 2","summary":"Summary 2","body":"Body 2","next_action":"Next 2"}', 'en', '{"to":"new@example.test","subject":"New subject","body":"New body","cc":["not-an-email"]}')$$,
  'P0001', 'invalid action payload', 'invalid Cc recipients are rejected'
);

select ok(public.approve_case_action('66000000-0000-4000-8000-000000000606', 1, repeat('a', 64), repeat('b', 64)) is not null, 'the original draft can be approved exactly');
select is((select count(*)::integer from public.audit_events where entity_id = '66000000-0000-4000-8000-000000000606' and event_type = 'artifact_approved' and metadata->>'artifact_revision' = '1'), 1, 'action approval writes its audit event atomically');
select ok(
  public.create_case_revision(
    '66000000-0000-4000-8000-000000000606', 1,
    '{"title":"Draft 2","summary":"Summary 2","body":"Body 2","next_action":"Next 2"}', 'en',
    '{"to":"new@example.test","cc":["copy@example.test"],"bcc":["blind@example.test"],"subject":"New subject","body":"New body","thread_id":"thread-123"}'
  ) is not null,
  'editing an approved draft creates the next immutable revision'
);
select is((select current_revision from public.cases where id = '66000000-0000-4000-8000-000000000606'), 2, 'the edit advances the case revision exactly once');
select ok((select revoked_at is not null from public.case_approvals where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 1), 'the previous exact approval is revoked');
select is((select status::text from public.case_actions where id = '66000000-0000-4000-8000-000000000616'), 'cancelled', 'the superseded pending action is cancelled');
select ok(not has_function_privilege('authenticated', 'public.claim_case_action_attempt(uuid,text,text,uuid,uuid)', 'execute'), 'browser sessions cannot call the explicit-actor claim RPC');
set local role service_role;
select is(
  public.claim_case_action_attempt('66000000-0000-4000-8000-000000000616', 'revision-old-action-0006', '<solo-os-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@actions.solo-company-os.invalid>', '66000000-0000-4000-8000-000000000617', '66000000-0000-4000-8000-000000000006'),
  null::uuid,
  'a cancelled old action cannot be claimed or executed'
);
set local role authenticated;
set local request.jwt.claim.sub = '66000000-0000-4000-8000-000000000006';
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  $$select public.approve_case_action('66000000-0000-4000-8000-000000000606', 1, repeat('a', 64), repeat('b', 64))$$,
  'P0001', 'stale artifact', 'revision 1 cannot be approved after revision 2 exists'
);
select ok((select payload_hash <> repeat('b', 64) from public.case_actions where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 2), 'the changed action payload receives a fresh hash');
select ok((select payload->'cc' = '["copy@example.test"]'::jsonb from public.case_actions where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 2), 'the approved Cc recipients are retained');
select ok((select payload->'bcc' = '["blind@example.test"]'::jsonb from public.case_actions where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 2), 'the approved Bcc recipients are retained');
select is((select payload->>'thread_id' from public.case_actions where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 2), 'thread-123', 'the approved Gmail thread is retained');
select is((select status::text from public.cases where id = '66000000-0000-4000-8000-000000000606'), 'awaiting_approval', 'the new revision returns to awaiting approval');
select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 1, '{"title":"Draft 3","summary":"Summary 3","body":"Body 3","next_action":"Next 3"}', 'en', '{"to":"new@example.test","subject":"Newer","body":"Newer body"}')$$,
  'P0001', 'stale case revision', 'a stale tab cannot overwrite the current revision'
);
select ok(
  public.approve_case_action(
    '66000000-0000-4000-8000-000000000606', 2,
    (select content_hash from public.case_artifacts where case_id = '66000000-0000-4000-8000-000000000606' and revision = 2),
    (select payload_hash from public.case_actions where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 2)
  ) is not null,
  'the new exact revision can be approved'
);
select is((select count(*)::integer from public.audit_events where entity_id = '66000000-0000-4000-8000-000000000606' and event_type = 'artifact_approved' and metadata->>'artifact_revision' = '2'), 1, 'the fresh action approval writes its audit event atomically');
select is((select status::text from public.cases where id = '66000000-0000-4000-8000-000000000606'), 'action_pending', 'approval of N+1 advances to action pending');

set local role postgres;
select ok(
  public.claim_case_action_attempt(
    (select id from public.case_actions where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 2),
    (select idempotency_key from public.case_actions where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 2),
    '<solo-os-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@actions.solo-company-os.invalid>',
    '66000000-0000-4000-8000-000000000617',
    '66000000-0000-4000-8000-000000000006'
  ) is not null,
  'the new action can enter the executing state through its claim gate'
);
set local role authenticated;
set local request.jwt.claim.sub = '66000000-0000-4000-8000-000000000006';
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 2, '{"title":"Draft 3","summary":"Summary 3","body":"Body 3","next_action":"Next 3"}', 'en', '{"to":"new@example.test","subject":"Newer","body":"Newer body"}')$$,
  'P0001', 'action is already executing or executed', 'an executing action cannot be edited'
);
set local request.jwt.claim.sub = '66000000-0000-0000-0000-000000000007';
set local request.jwt.claims = '{"sub":"66000000-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok(
  $$select public.approve_case_action('66000000-0000-4000-8000-000000000606', 2, (select content_hash from public.case_artifacts where case_id = '66000000-0000-4000-8000-000000000606' and revision = 2), (select payload_hash from public.case_actions where case_id = '66000000-0000-4000-8000-000000000606' and artifact_revision = 2))$$,
  'P0001', 'not authorized', 'a member of another workspace cannot approve this case'
);
select throws_ok(
  $$select public.create_case_revision('66000000-0000-4000-8000-000000000606', 2, '{"title":"Draft 3","summary":"Summary 3","body":"Body 3","next_action":"Next 3"}', 'en', '{"to":"new@example.com","subject":"Newer","body":"Newer body"}')$$,
  'P0001', 'not authorized', 'a member of another workspace cannot create this revision'
);

select * from finish();
rollback;
