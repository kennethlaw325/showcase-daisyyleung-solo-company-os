begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(59);

-- Legacy mutation signatures are unavailable to every caller, including the
-- service role.  The signatures remain only so existing migration history can
-- be upgraded without dropping objects.
select ok(not has_function_privilege('anon', 'public.reserve_workspace_ai_quota(uuid,text,numeric,integer)', 'execute'), 'legacy browser quota mutations are inaccessible to anon');
select ok(not has_function_privilege('authenticated', 'public.reserve_workspace_ai_quota(uuid,text,numeric,integer)', 'execute'), 'legacy browser quota mutations are inaccessible to authenticated');
select ok(not has_function_privilege('service_role', 'public.reserve_workspace_ai_quota(uuid,text,numeric,integer)', 'execute'), 'legacy browser quota mutations are inaccessible to service role');
select ok(
  not coalesce(has_function_privilege('anon', to_regprocedure('public.consume_workspace_quota(uuid,integer)'), 'execute'), false)
    and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.consume_workspace_quota(uuid,integer)'), 'execute'), false)
    and not coalesce(has_function_privilege('service_role', to_regprocedure('public.consume_workspace_quota(uuid,integer)'), 'execute'), false),
  'legacy consume quota RPC is absent or non-executable'
);
select ok(not has_function_privilege('anon', 'public.complete_workspace_usage(bigint,integer,integer,integer,numeric)', 'execute'), 'legacy completion RPC is inaccessible to anon');
select ok(not has_function_privilege('authenticated', 'public.complete_workspace_usage(bigint,integer,integer,integer,numeric)', 'execute'), 'legacy completion RPC is inaccessible to authenticated');
select ok(not has_function_privilege('service_role', 'public.complete_workspace_usage(bigint,integer,integer,integer,numeric)', 'execute'), 'legacy completion RPC is inaccessible to service role');

select ok(not has_function_privilege('anon', 'public.reserve_workspace_ai_quota(uuid,uuid,text,numeric,integer)', 'execute'), 'legacy explicit-actor reserve is not browser-callable by anon');
select ok(not has_function_privilege('authenticated', 'public.reserve_workspace_ai_quota(uuid,uuid,text,numeric,integer)', 'execute'), 'legacy explicit-actor reserve is not browser-callable by authenticated');
select ok(not has_function_privilege('service_role', 'public.reserve_workspace_ai_quota(uuid,uuid,text,numeric,integer)', 'execute'), 'legacy explicit-actor reserve is unavailable to service role');
select ok(not has_function_privilege('anon', 'public.reserve_workspace_ai_quota(uuid,uuid,text,text,numeric,integer)', 'execute'), 'provider-attributed reserve is not browser-callable by anon');
select ok(not has_function_privilege('authenticated', 'public.reserve_workspace_ai_quota(uuid,uuid,text,text,numeric,integer)', 'execute'), 'provider-attributed reserve is not browser-callable by authenticated');
select ok(has_function_privilege('service_role', 'public.reserve_workspace_ai_quota(uuid,uuid,text,text,numeric,integer)', 'execute'), 'provider-attributed reserve is service-role-only');
select ok(not has_function_privilege('anon', 'public.complete_workspace_usage(bigint,uuid,integer,integer,integer,numeric)', 'execute'), 'explicit-actor completion is not browser-callable by anon');
select ok(not has_function_privilege('authenticated', 'public.complete_workspace_usage(bigint,uuid,integer,integer,integer,numeric)', 'execute'), 'explicit-actor completion is not browser-callable by authenticated');
select ok(has_function_privilege('service_role', 'public.complete_workspace_usage(bigint,uuid,integer,integer,integer,numeric)', 'execute'), 'explicit-actor completion is service-role-only');

select ok(has_function_privilege('authenticated', 'public.get_workspace_daily_ai_call_cap(uuid)', 'execute'), 'authenticated retains daily cap read access');
select ok(not has_function_privilege('anon', 'public.get_workspace_daily_ai_call_cap(uuid)', 'execute'), 'anon cannot read daily cap');
select ok(not has_function_privilege('anon', 'public.is_workspace_member(uuid)', 'execute'), 'anon cannot execute membership helper');
select ok(has_function_privilege('authenticated', 'public.is_workspace_member(uuid)', 'execute'), 'authenticated retains membership helper access');
select ok(not has_function_privilege('anon', 'public.is_workspace_admin(uuid)', 'execute'), 'anon cannot execute admin helper');
select ok(has_function_privilege('authenticated', 'public.is_workspace_admin(uuid)', 'execute'), 'authenticated retains admin helper access');

select ok(not has_function_privilege('anon', 'public.refresh_learning_search_document()', 'execute'), 'anon cannot execute the learning search trigger');
select ok(not has_function_privilege('authenticated', 'public.refresh_learning_search_document()', 'execute'), 'authenticated cannot execute the learning search trigger');
select ok(not has_function_privilege('service_role', 'public.refresh_learning_search_document()', 'execute'), 'service role cannot execute the learning search trigger directly');
select ok(not has_function_privilege('anon', 'public.touch_updated_at()', 'execute'), 'anon cannot execute the updated-at trigger');
select ok(not has_function_privilege('authenticated', 'public.touch_updated_at()', 'execute'), 'authenticated cannot execute the updated-at trigger');
select ok(not has_function_privilege('service_role', 'public.touch_updated_at()', 'execute'), 'service role cannot execute the updated-at trigger directly');
select ok(not has_function_privilege('anon', 'public.reject_audit_mutation()', 'execute'), 'anon cannot execute the audit trigger');
select ok(not has_function_privilege('authenticated', 'public.reject_audit_mutation()', 'execute'), 'authenticated cannot execute the audit trigger');
select ok(not has_function_privilege('service_role', 'public.reject_audit_mutation()', 'execute'), 'service role cannot execute the audit trigger directly');
select ok(not has_function_privilege('anon', 'public.reject_artifact_locale_mutation()', 'execute'), 'anon cannot execute the artifact locale trigger');
select ok(not has_function_privilege('authenticated', 'public.reject_artifact_locale_mutation()', 'execute'), 'authenticated cannot execute the artifact locale trigger');
select ok(not has_function_privilege('service_role', 'public.reject_artifact_locale_mutation()', 'execute'), 'service role cannot execute the artifact locale trigger directly');
select ok(not has_function_privilege('anon', 'public.reject_case_work_packet_mutation()', 'execute'), 'anon cannot execute the work packet trigger');
select ok(not has_function_privilege('authenticated', 'public.reject_case_work_packet_mutation()', 'execute'), 'authenticated cannot execute the work packet trigger');
select ok(not has_function_privilege('service_role', 'public.reject_case_work_packet_mutation()', 'execute'), 'service role cannot execute the work packet trigger directly');
select ok(not has_function_privilege('anon', 'public.reject_case_intake_context_mutation()', 'execute'), 'anon cannot execute the intake context trigger');
select ok(not has_function_privilege('authenticated', 'public.reject_case_intake_context_mutation()', 'execute'), 'authenticated cannot execute the intake context trigger');
select ok(not has_function_privilege('service_role', 'public.reject_case_intake_context_mutation()', 'execute'), 'service role cannot execute the intake context trigger directly');

select ok(not has_table_privilege('anon', 'public.platform_admins', 'select'), 'platform admin table has no anon access');
select ok(not has_table_privilege('authenticated', 'public.platform_admins', 'select'), 'platform admin table has no authenticated access');
select ok(not has_table_privilege('anon', 'public.public_rate_limits', 'select'), 'public rate-limit table has no anon access');
select ok(not has_table_privilege('authenticated', 'public.public_rate_limits', 'select'), 'public rate-limit table has no authenticated access');
select ok(not has_table_privilege('anon', 'public.workspace_ai_quota_overrides', 'select'), 'quota override table has no anon access');
select ok(not has_table_privilege('authenticated', 'public.workspace_ai_quota_overrides', 'select'), 'quota override table has no authenticated access');

insert into auth.users (id, email) values
  ('11000000-0000-4000-8000-000000000011', 'quota-owner@example.test'),
  ('12000000-0000-4000-8000-000000000012', 'quota-member@example.test'),
  ('13000000-0000-4000-8000-000000000013', 'quota-other@example.test');
insert into public.workspaces (id, name, slug) values
  ('a1000000-0000-4000-8000-000000000011', 'Quota A', 'quota-a-boundary'),
  ('b1000000-0000-4000-8000-000000000012', 'Quota B', 'quota-b-boundary');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('a1000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000011', 'owner'),
  ('a1000000-0000-4000-8000-000000000011', '12000000-0000-4000-8000-000000000012', 'member'),
  ('b1000000-0000-4000-8000-000000000012', '13000000-0000-4000-8000-000000000013', 'owner');

set local role service_role;
create temporary table quota_security_reservations (id bigint);
grant select, insert on quota_security_reservations to service_role;

insert into quota_security_reservations(id)
  values (public.reserve_workspace_ai_quota(
    'a1000000-0000-4000-8000-000000000011',
    '11000000-0000-4000-8000-000000000011',
    'gemini',
    'security-test-model', 0, 1
  ));
select ok((select count(*) = 1 from quota_security_reservations where id is not null), 'the correct actor can reserve workspace quota');
set local role postgres;
select is(
  (select user_id from public.usage_events where id = (select id from quota_security_reservations limit 1)),
  '11000000-0000-4000-8000-000000000011'::uuid,
  'the reservation persists the explicit actor as its owner'
);
select is(
  (select provider from public.usage_events where id = (select id from quota_security_reservations limit 1)),
  'gemini',
  'the reservation persists the explicit provider attribution'
);
set local role service_role;
select is(
  public.reserve_workspace_ai_quota('a1000000-0000-4000-8000-000000000011', '13000000-0000-4000-8000-000000000013', 'gemini', 'security-test-model', 0, 1),
  null::bigint,
  'a cross-workspace actor cannot reserve another workspace quota'
);
select ok(
  public.reserve_workspace_ai_quota('a1000000-0000-4000-8000-000000000011', '12000000-0000-4000-8000-000000000012', 'openai', 'security-test-model', 0, 1) is not null,
  'a same-workspace member can reserve quota for their own actor'
);
select throws_ok(
  $$select public.reserve_workspace_ai_quota('a1000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000011', 'invalid-provider', 'security-test-model', 0, 1)$$,
  'P0001', 'unsupported AI provider', 'an invalid provider fails loudly'
);
select is(
  public.complete_workspace_usage((select id from quota_security_reservations limit 1), '11000000-0000-4000-8000-000000000011', 10, 5, 15, 0.01),
  true,
  'the reservation owner can complete their own usage'
);
set local role postgres;
select is(
  (select provider from public.usage_events where id = (select id from quota_security_reservations limit 1)),
  'gemini',
  'usage completion preserves the reservation provider attribution'
);
set local role service_role;
select is(
  public.complete_workspace_usage((select id from quota_security_reservations limit 1), '12000000-0000-4000-8000-000000000012', 20, 10, 30, 0.02),
  false,
  'a same-workspace wrong actor cannot complete another actor reservation'
);
select is(
  public.complete_workspace_usage((select id from quota_security_reservations limit 1), '13000000-0000-4000-8000-000000000013', 20, 10, 30, 0.02),
  false,
  'a cross-workspace actor cannot complete another actor reservation'
);

select ok((select coalesce(array_to_string(proconfig, ','), '') like '%search_path=public%' from pg_proc where oid = 'public.touch_updated_at()'::regprocedure), 'touch_updated_at has an immutable public search path');
select ok((select coalesce(array_to_string(proconfig, ','), '') like '%search_path=public%' from pg_proc where oid = 'public.storage_source_object_is_valid(text,jsonb)'::regprocedure), 'storage validation has an immutable public search path');
select ok((select coalesce(array_to_string(proconfig, ','), '') like '%search_path=public%' from pg_proc where oid = 'public.reject_audit_mutation()'::regprocedure), 'audit trigger has an immutable public search path');

select * from finish();
rollback;
