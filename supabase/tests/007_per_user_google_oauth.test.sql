begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(26);

insert into auth.users (id, email) values
  ('77000000-0000-4000-8000-000000000007', 'oauth-owner@example.test'),
  ('77000000-0000-4000-8000-000000000008', 'oauth-member@example.test'),
  ('77000000-0000-4000-8000-000000000009', 'oauth-other@example.test');
insert into public.workspaces (id, name, slug) values
  ('77000000-0000-4000-8000-000000000070', 'OAuth workspace', 'oauth-per-user-test'),
  ('77000000-0000-4000-8000-000000000071', 'Other OAuth workspace', 'oauth-other-workspace');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000007', 'owner'),
  ('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000008', 'member'),
  ('77000000-0000-4000-8000-000000000071', '77000000-0000-4000-8000-000000000009', 'owner');

insert into public.oauth_connections(
  id, workspace_id, provider, provider_account_id, secret_ref, scopes, created_by,
  owner_user_id, provider_account_email, mailbox_email
) values
  ('77000000-0000-4000-8000-000000000701', '77000000-0000-4000-8000-000000000070', 'google', 'google-sub-owner', vault.create_secret('{"access_token":"owner-token"}', 'oauth-owner-secret'), array['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'], '77000000-0000-4000-8000-000000000007', '77000000-0000-4000-8000-000000000007', 'owner@example.test', 'owner@example.test'),
  ('77000000-0000-4000-8000-000000000702', '77000000-0000-4000-8000-000000000070', 'google', 'google-sub-member', vault.create_secret('{"access_token":"member-token"}', 'oauth-member-secret'), array['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'], '77000000-0000-4000-8000-000000000008', '77000000-0000-4000-8000-000000000008', 'member@example.test', 'member@example.test'),
  ('77000000-0000-4000-8000-000000000703', '77000000-0000-4000-8000-000000000071', 'google', '77000000-0000-4000-8000-000000000009', vault.create_secret('{"access_token":"legacy-token"}', 'oauth-legacy-secret'), array['gmail.compose'], '77000000-0000-4000-8000-000000000009', '77000000-0000-4000-8000-000000000009', null, null);

select ok(not has_function_privilege('authenticated', 'public.connect_google_oauth(uuid,uuid,text,text,text,boolean,text[],text)', 'execute'), 'authenticated clients cannot connect Vault secrets');
select ok(not has_function_privilege('authenticated', 'public.read_oauth_connection_secret(uuid,uuid,uuid)', 'execute'), 'authenticated clients cannot read Vault secrets');
select ok(has_function_privilege('service_role', 'public.read_oauth_connection_secret(uuid,uuid,uuid)', 'execute'), 'service role can read the owner-bound Vault secret');
select ok(not has_function_privilege('authenticated', 'public.begin_oauth_connection_refresh(uuid,uuid,uuid)', 'execute'), 'authenticated clients cannot lease refresh tokens');

set local role authenticated;
set local request.jwt.claim.sub = '77000000-0000-4000-8000-000000000007';
set local request.jwt.claims = '{"sub":"77000000-0000-4000-8000-000000000007","role":"authenticated"}';
select results_eq($$select count(*) from public.oauth_connections$$, array[1::bigint], 'a user sees only their own connection');
set local request.jwt.claim.sub = '77000000-0000-4000-8000-000000000008';
set local request.jwt.claims = '{"sub":"77000000-0000-4000-8000-000000000008","role":"authenticated"}';
select results_eq($$select count(*) from public.oauth_connections$$, array[1::bigint], 'a same-workspace user cannot read another user connection');
set local request.jwt.claim.sub = '77000000-0000-4000-8000-000000000009';
set local request.jwt.claims = '{"sub":"77000000-0000-4000-8000-000000000009","role":"authenticated"}';
select results_eq($$select count(*) from public.oauth_connections where workspace_id = '77000000-0000-4000-8000-000000000070'$$, array[0::bigint], 'a different workspace cannot read the connection');
select is((select status::text from public.oauth_connections where id = '77000000-0000-4000-8000-000000000703'), 'reauthorization_required', 'legacy Supabase UUID rows require reauthorization');

set local role service_role;
select throws_ok(
  $$select public.connect_google_oauth('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000009', 'new-sub', 'other@example.test', 'other@example.test', true, array['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'], '{"access_token":"bad-owner"}')$$,
  'P0001', 'workspace owner unavailable', 'connect rejects an owner who is not a member of the supplied workspace'
);
select ok(
  public.connect_google_oauth('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000007', 'google-sub-owner-v2', 'owner@example.test', 'owner@example.test', true, array['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'], '{"access_token":"owner-token-v2"}') is not null,
  'connect atomically updates the owner connection and Vault secret'
);
set local role postgres;
select is((select provider_account_id from public.oauth_connections where id = '77000000-0000-4000-8000-000000000701'), 'google-sub-owner-v2', 'the connection stores the verified Google subject rather than the Supabase UUID');

insert into public.cases(id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by)
  values ('77000000-0000-4000-8000-000000000711', '77000000-0000-4000-8000-000000000070', 'growth', 'growth', 1, 'OAuth action case', 'OAuth action brief', 'action_pending', 1, '77000000-0000-4000-8000-000000000007');
insert into public.case_artifacts(workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, created_by)
  values ('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000711', 1, '{"title":"OAuth action"}', repeat('a', 64), 'en', 'growth', 1, '77000000-0000-4000-8000-000000000007');
insert into public.case_actions(id, workspace_id, case_id, artifact_revision, action_type, payload, payload_hash, idempotency_key, created_by)
  values
    ('77000000-0000-4000-8000-000000000712', '77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000711', 1, 'gmail.create_draft', '{"to":"owner@example.test","subject":"One","body":"One"}', repeat('b', 64), 'oauth-action-one-0007', '77000000-0000-4000-8000-000000000007'),
    ('77000000-0000-4000-8000-000000000713', '77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000711', 1, 'gmail.create_draft', '{"to":"owner@example.test","subject":"Two","body":"Two"}', repeat('c', 64), 'oauth-action-two-0007', '77000000-0000-4000-8000-000000000007');
insert into public.case_approvals(workspace_id, case_id, artifact_revision, artifact_hash, action_payload_hash, approved_by)
  values
    ('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000711', 1, repeat('a', 64), repeat('b', 64), '77000000-0000-4000-8000-000000000007'),
    ('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000711', 1, repeat('a', 64), repeat('c', 64), '77000000-0000-4000-8000-000000000007');

set local role authenticated;
set local request.jwt.claim.sub = '77000000-0000-4000-8000-000000000007';
set local request.jwt.claims = '{"sub":"77000000-0000-4000-8000-000000000007","role":"authenticated"}';
select ok(not has_function_privilege('authenticated', 'public.claim_case_action_attempt(uuid,text,text,uuid,uuid)', 'execute'), 'browser clients cannot invoke Gmail claim orchestration');
set local role service_role;
select ok(public.claim_case_action_attempt('77000000-0000-4000-8000-000000000712', 'oauth-action-one-0007', '<solo-os-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@actions.solo-company-os.invalid>', '77000000-0000-4000-8000-000000000701', '77000000-0000-4000-8000-000000000007') is not null, 'the owner can claim an action with their own connection');
select is(public.claim_case_action_attempt('77000000-0000-4000-8000-000000000713', 'oauth-action-two-0007', '<solo-os-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@actions.solo-company-os.invalid>', '77000000-0000-4000-8000-000000000702', '77000000-0000-4000-8000-000000000007'), null::uuid, 'a member cannot claim with another user connection');
select ok(public.claim_case_action_attempt('77000000-0000-4000-8000-000000000713', 'oauth-action-two-0007', '<solo-os-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@actions.solo-company-os.invalid>', '77000000-0000-4000-8000-000000000701', '77000000-0000-4000-8000-000000000007') is not null, 'the owner can claim a second action with the exact owned connection');
set local role postgres;
select ok((select execution_actor_id = '77000000-0000-4000-8000-000000000007' and execution_connection_id = '77000000-0000-4000-8000-000000000701' and execution_connection_version is not null and execution_connection_email = 'owner@example.test' from public.case_actions where id = '77000000-0000-4000-8000-000000000713'), 'claim stamps actor, connection, token version, and mailbox snapshot');

select throws_ok(
  $$select public.connect_google_oauth('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000007', 'google-sub-owner-v3', 'owner@example.test', 'owner@example.test', true, array['https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'], '{"access_token":"owner-token-v3"}')$$,
  'P0001', 'connection has executing action', 'reconnect cannot overwrite a connection while an action is executing'
);
select throws_ok($$select public.begin_oauth_disconnect('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000007', '77000000-0000-4000-8000-000000000701')$$, 'P0001', 'connection has executing action', 'disconnect refuses while the connection has an executing action');

select is(public.record_case_action_reconciliation_check('77000000-0000-4000-8000-000000000713', (select execution_attempt_id from public.case_actions where id = '77000000-0000-4000-8000-000000000713'), '77000000-0000-4000-8000-000000000008'), false, 'retry reconciliation is bound to the original actor');

set local role postgres;
update public.case_approvals set revoked_at = now() where action_payload_hash = repeat('b', 64);
select is(public.mark_case_action_executed_attempt('77000000-0000-4000-8000-000000000712', (select execution_attempt_id from public.case_actions where id = '77000000-0000-4000-8000-000000000712'), 'draft-one', '<solo-os-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@actions.solo-company-os.invalid>', '77000000-0000-4000-8000-000000000007', false), false, 'finalize rejects a revoked approval');
select ok(public.mark_case_action_executed_attempt('77000000-0000-4000-8000-000000000713', (select execution_attempt_id from public.case_actions where id = '77000000-0000-4000-8000-000000000713'), 'draft-two', '<solo-os-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@actions.solo-company-os.invalid>', '77000000-0000-4000-8000-000000000007', false), 'the original actor can finalize the exact unrevoked approval');
select is((select status::text from public.case_actions where id = '77000000-0000-4000-8000-000000000713'), 'executed', 'finalization records the provider result');
select is((select status::text from public.case_actions where id = '77000000-0000-4000-8000-000000000712'), 'executing', 'a revoked approval remains executing for reconciliation rather than silently succeeding');

set local role postgres;
update public.case_actions set status = 'failed' where id = '77000000-0000-4000-8000-000000000712';
select ok(public.begin_oauth_disconnect('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000007', '77000000-0000-4000-8000-000000000701') is not null, 'disconnect begin keeps local state until provider revoke succeeds');
select ok(public.finish_oauth_disconnect('77000000-0000-4000-8000-000000000070', '77000000-0000-4000-8000-000000000007', '77000000-0000-4000-8000-000000000701'), 'disconnect finish atomically deletes local row and encrypted secret');
select is((select count(*) from public.oauth_connections where id = '77000000-0000-4000-8000-000000000701'), 0::bigint, 'disconnected connection is no longer locally visible');

select * from finish();
rollback;
