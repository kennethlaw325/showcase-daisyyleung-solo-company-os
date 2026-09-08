begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

select ok(not has_table_privilege('anon', 'public.pilot_applications', 'insert'), 'anon cannot bypass the pilot submission RPC with a direct insert');
select ok(not has_table_privilege('authenticated', 'public.pilot_applications', 'insert'), 'authenticated cannot bypass the pilot submission RPC with a direct insert');
select ok(has_function_privilege('service_role', 'public.submit_pilot_application(text,text,text,text,text,text,text,text,uuid,boolean,text,text)', 'execute'), 'service role can execute the consented pilot submission RPC');
select ok(not has_function_privilege('anon', 'public.submit_pilot_application(text,text,text,text,text,text,text,text,uuid,boolean,text,text)', 'execute'), 'anon cannot execute the pilot submission RPC');
select ok(not has_function_privilege('authenticated', 'public.submit_pilot_application(text,text,text,text,text,text,text,text,uuid,boolean,text,text)', 'execute'), 'authenticated cannot execute the pilot submission RPC');
select ok(not has_function_privilege('authenticated', 'public.claim_case_action_attempt(uuid,text,text,uuid,uuid)', 'execute'), 'browser clients cannot claim Gmail actions');
select ok(not has_function_privilege('authenticated', 'public.mark_case_action_executed_attempt(uuid,uuid,text,text,uuid,boolean)', 'execute'), 'browser clients cannot finalize Gmail actions');
select ok(not has_function_privilege('authenticated', 'public.record_case_action_reconciliation_check(uuid,uuid,uuid)', 'execute'), 'browser clients cannot record Gmail reconciliation');
select ok(has_function_privilege('service_role', 'public.claim_case_action_attempt(uuid,text,text,uuid,uuid)', 'execute'), 'service role can claim with an explicit actor');
select ok(has_function_privilege('service_role', 'public.mark_case_action_executed_attempt(uuid,uuid,text,text,uuid,boolean)', 'execute'), 'service role can finalize with an explicit actor');
select ok(has_function_privilege('service_role', 'public.record_case_action_reconciliation_check(uuid,uuid,uuid)', 'execute'), 'service role can reconcile with an explicit actor');
select ok(not has_function_privilege('service_role', 'public.claim_case_action_attempt(uuid,text,text,uuid)', 'execute'), 'the legacy connection-bound claim signature is disabled even for service role');
select ok(not has_function_privilege('service_role', 'public.claim_case_action(uuid,text)', 'execute'), 'the legacy claim RPC is disabled even for service role');
select ok(not has_function_privilege('service_role', 'public.mark_case_action_executed(uuid,text)', 'execute'), 'the legacy finalize RPC is disabled even for service role');
select ok(
  not coalesce(has_function_privilege('anon', to_regprocedure('public.revoke_case_approvals(uuid,integer)'), 'execute'), false)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.revoke_case_approvals(uuid,integer)'), 'execute'), false)
    and not coalesce(has_function_privilege('service_role', to_regprocedure('public.revoke_case_approvals(uuid,integer)'), 'execute'), false),
  'the obsolete approval revocation RPC is absent or non-executable'
);
select ok(
  not coalesce(has_function_privilege('anon', to_regprocedure('public.store_oauth_secret(uuid,text,text)'), 'execute'), false)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.store_oauth_secret(uuid,text,text)'), 'execute'), false)
    and not coalesce(has_function_privilege('service_role', to_regprocedure('public.store_oauth_secret(uuid,text,text)'), 'execute'), false),
  'the obsolete Vault store RPC is absent or non-executable'
);
select ok(
  not coalesce(has_function_privilege('anon', to_regprocedure('public.read_oauth_secret(uuid,uuid)'), 'execute'), false)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.read_oauth_secret(uuid,uuid)'), 'execute'), false)
    and not coalesce(has_function_privilege('service_role', to_regprocedure('public.read_oauth_secret(uuid,uuid)'), 'execute'), false),
  'the obsolete Vault read RPC is absent or non-executable'
);
select ok(
  not coalesce(has_function_privilege('anon', to_regprocedure('public.update_oauth_secret(uuid,uuid,text)'), 'execute'), false)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.update_oauth_secret(uuid,uuid,text)'), 'execute'), false)
    and not coalesce(has_function_privilege('service_role', to_regprocedure('public.update_oauth_secret(uuid,uuid,text)'), 'execute'), false),
  'the obsolete Vault update RPC is absent or non-executable'
);
select ok(
  not coalesce(has_function_privilege('anon', to_regprocedure('public.delete_oauth_secret(uuid,uuid)'), 'execute'), false)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.delete_oauth_secret(uuid,uuid)'), 'execute'), false)
    and not coalesce(has_function_privilege('service_role', to_regprocedure('public.delete_oauth_secret(uuid,uuid)'), 'execute'), false),
  'the obsolete Vault delete RPC is absent or non-executable'
);

set local role service_role;
select ok(public.submit_pilot_application('SECURITY-TEST@EXAMPLE.TEST', 'Security Test', null, null, 'Bounded application', 'en', null, null, 'a1400000-0000-4000-8000-000000000001', true, 'founding-pilot-2026-08-21-v1', 'en') is not null, 'the service RPC inserts a fixed new pilot status');
set local role postgres;
select is((select status from public.pilot_applications where email = 'security-test@example.test' order by created_at desc limit 1), 'new', 'pilot submissions always start as new');
select throws_ok($$select public.submit_pilot_application('bad@example.test', '', null, null, 'Bounded application', 'en', null, null, 'a1400000-0000-4000-8000-000000000002', true, 'founding-pilot-2026-08-21-v1', 'en')$$, 'P0001', 'invalid application name', 'pilot fields are strictly bounded');
select ok(public.submit_pilot_application('rate@example.test', 'Rate Test', null, null, 'Bounded application', 'en', null, repeat('b', 64), 'a1400000-0000-4000-8000-000000000010', true, 'founding-pilot-2026-08-21-v1', 'en') is not null, 'the first metadata bucket request succeeds');
select ok((select count(*) from generate_series(1, 4) as request(n) where public.submit_pilot_application('rate@example.test', 'Rate Test', null, null, 'Bounded application', 'en', null, repeat('b', 64), ('a1400000-0000-4000-8000-' || lpad((10 + request.n)::text, 12, '0'))::uuid, true, 'founding-pilot-2026-08-21-v1', 'en') is not null) = 4, 'the remaining metadata bucket requests succeed');
select is(public.submit_pilot_application('rate@example.test', 'Rate Test', null, null, 'Bounded application', 'en', null, repeat('b', 64), 'a1400000-0000-4000-8000-000000000015', true, 'founding-pilot-2026-08-21-v1', 'en'), null::uuid, 'the exhausted metadata bucket returns no application');

select * from finish();
rollback;
