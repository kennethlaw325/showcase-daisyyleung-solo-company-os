begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(29);

-- Browser roles cannot write or read pilot applications directly.
select ok(not has_table_privilege('anon', 'public.pilot_applications', 'insert'), 'anon cannot insert pilot applications directly');
select ok(not has_table_privilege('authenticated', 'public.pilot_applications', 'insert'), 'authenticated cannot insert pilot applications directly');

select ok(has_function_privilege('service_role', 'public.submit_pilot_application(text,text,text,text,text,text,text,text,uuid,boolean,text,text)', 'execute'), 'service role can execute the consented submission RPC');
select ok(not has_function_privilege('anon', 'public.submit_pilot_application(text,text,text,text,text,text,text,text,uuid,boolean,text,text)', 'execute'), 'anon cannot execute the consented submission RPC');
select ok(not has_function_privilege('authenticated', 'public.submit_pilot_application(text,text,text,text,text,text,text,text,uuid,boolean,text,text)', 'execute'), 'authenticated cannot execute the consented submission RPC');

select ok(not has_function_privilege('anon', 'public.submit_pilot_application(text,text,text,text,text,text,text,text)', 'execute'), 'anon cannot execute the legacy submission signature');
select ok(not has_function_privilege('authenticated', 'public.submit_pilot_application(text,text,text,text,text,text,text,text)', 'execute'), 'authenticated cannot execute the legacy submission signature');
select ok(not has_function_privilege('service_role', 'public.submit_pilot_application(text,text,text,text,text,text,text,text)', 'execute'), 'service role cannot execute the legacy submission signature');

set local role service_role;
select ok(
  public.submit_pilot_application(
    'PILOT-CONSENT@EXAMPLE.TEST', 'Consent Test', null, 'Consultant',
    'A bounded pilot goal', 'en', null, null,
    'a1400000-0000-4000-8000-000000000101', true,
    'founding-pilot-2026-08-21-v1', 'en'
  ) is not null,
  'valid English consent returns the inserted application id'
);
set local role postgres;
select is((select consent_policy_version from public.pilot_applications where submission_id = 'a1400000-0000-4000-8000-000000000101'), 'founding-pilot-2026-08-21-v1', 'the active policy version is persisted');
select is((select consent_locale from public.pilot_applications where submission_id = 'a1400000-0000-4000-8000-000000000101'), 'en', 'the consent locale is persisted');
select ok((select consented_at between clock_timestamp() - interval '1 minute' and clock_timestamp() from public.pilot_applications where submission_id = 'a1400000-0000-4000-8000-000000000101'), 'consent timestamp comes from database time');
select is((select count(*)::integer from public.audit_events where entity_id = (select id from public.pilot_applications where submission_id = 'a1400000-0000-4000-8000-000000000101') and event_type = 'application_submitted'), 1, 'first insertion writes one content-free audit event');
select is((select metadata from public.audit_events where entity_id = (select id from public.pilot_applications where submission_id = 'a1400000-0000-4000-8000-000000000101') and event_type = 'application_submitted'), '{}'::jsonb, 'consent audit metadata is content-free');

set local role service_role;
select ok(public.submit_pilot_application('PILOT-CONSENT@EXAMPLE.TEST', 'Consent Test', null, 'Consultant', 'A bounded pilot goal', 'en', null, null, 'a1400000-0000-4000-8000-000000000101', true, 'founding-pilot-2026-08-21-v1', 'en') is not null, 'an exact retry returns the existing application before rate limiting');
set local role postgres;
select is((select count(*)::integer from public.pilot_applications where submission_id = 'a1400000-0000-4000-8000-000000000101'), 1, 'an exact retry keeps one application row');
select is((select count(*)::integer from public.audit_events where entity_id = (select id from public.pilot_applications where submission_id = 'a1400000-0000-4000-8000-000000000101') and event_type = 'application_submitted'), 1, 'an exact retry writes no second audit event');

set local role service_role;
select throws_ok($$select public.submit_pilot_application('PILOT-CONSENT@EXAMPLE.TEST', 'Changed Name', null, 'Consultant', 'A bounded pilot goal', 'en', null, null, 'a1400000-0000-4000-8000-000000000101', true, 'founding-pilot-2026-08-21-v1', 'en')$$, 'P0001', 'pilot submission id already used with a different payload', 'a reused submission id with changed data fails closed');
select throws_ok($$select public.submit_pilot_application('false@example.test', 'False Consent', null, null, 'Goal', 'en', null, null, 'a1400000-0000-4000-8000-000000000102', false, 'founding-pilot-2026-08-21-v1', 'en')$$, 'P0001', 'pilot consent is required', 'false consent is rejected');
select throws_ok($$select public.submit_pilot_application('missing@example.test', 'Missing Id', null, null, 'Goal', 'en', null, null, null, true, 'founding-pilot-2026-08-21-v1', 'en')$$, 'P0001', 'pilot consent submission id is required', 'missing submission id is rejected');
select throws_ok($$select public.submit_pilot_application('wrong-version@example.test', 'Wrong Version', null, null, 'Goal', 'en', null, null, 'a1400000-0000-4000-8000-000000000103', true, 'old-version', 'en')$$, 'P0001', 'pilot consent policy is inactive', 'an inactive policy version is rejected');
select throws_ok($$select public.submit_pilot_application('wrong-locale@example.test', 'Wrong Locale', null, null, 'Goal', 'en', null, null, 'a1400000-0000-4000-8000-000000000104', true, 'founding-pilot-2026-08-21-v1', 'zh-Hant')$$, 'P0001', 'pilot consent locale mismatch', 'a consent locale different from input locale is rejected');
select throws_ok($$select public.submit_pilot_application('mismatch@example.test', 'Mismatch', null, null, 'Goal', 'zh-Hant', null, null, 'a1400000-0000-4000-8000-000000000105', true, 'founding-pilot-2026-08-21-v1', 'en')$$, 'P0001', 'pilot consent locale mismatch', 'a mismatched Traditional Chinese input locale is rejected');
set local role postgres;
select is((select count(*)::integer from public.pilot_applications where submission_id in ('a1400000-0000-4000-8000-000000000102', 'a1400000-0000-4000-8000-000000000103', 'a1400000-0000-4000-8000-000000000104', 'a1400000-0000-4000-8000-000000000105')), 0, 'rejected consent submission ids produce no rows');

set local role service_role;
select ok(public.submit_pilot_application('PILOT-ZH@EXAMPLE.TEST', '繁中申請', null, '顧問', '一項試用成果', 'zh-Hant', null, null, 'a1400000-0000-4000-8000-000000000106', true, 'founding-pilot-2026-08-21-v1', 'zh-Hant') is not null, 'valid Traditional Chinese consent is accepted');
set local role postgres;
select is((select consent_locale from public.pilot_applications where submission_id = 'a1400000-0000-4000-8000-000000000106'), 'zh-Hant', 'Traditional Chinese consent locale persists');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(not has_table_privilege('authenticated', 'public.pilot_applications', 'select'), 'tenant sessions cannot read pilot applications');
select throws_ok($$select count(*) from public.pilot_applications$$, '42501', 'permission denied for table pilot_applications', 'tenant pilot application reads fail closed');
select results_eq($$select count(*) from public.audit_events where workspace_id is null and event_type = 'application_submitted'$$, array[0::bigint], 'authenticated users cannot see the workspace-null consent audit receipt through audit RLS');

select * from finish();
rollback;
