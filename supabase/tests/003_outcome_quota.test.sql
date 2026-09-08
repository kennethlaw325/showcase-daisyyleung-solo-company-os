begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

insert into auth.users (id, email) values
  ('40000000-0000-4000-8000-000000000004', 'outcome@example.test'),
  ('50000000-0000-4000-8000-000000000005', 'other@example.test');
insert into public.workspaces (id, name, slug) values
  ('d0000000-0000-4000-8000-000000000004', 'Outcome workspace', 'outcome-workspace-test'),
  ('e0000000-0000-4000-8000-000000000005', 'Cost workspace', 'cost-workspace-test'),
  ('f0000000-0000-4000-8000-000000000006', 'Other workspace', 'other-workspace-test'),
  ('a0000000-0000-4000-8000-000000000007', 'Override workspace', 'override-workspace-test');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('d0000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', 'owner'),
  ('e0000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000004', 'owner'),
  ('f0000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000005', 'owner'),
  ('a0000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000004', 'owner');
insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by)
  values ('cd000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', 'operations', 'operations', 1, 'Outcome case', 'Outcome brief', 'outcome_pending', 1, '40000000-0000-4000-8000-000000000004');
insert into public.workspace_ai_quota_overrides(workspace_id, daily_call_cap)
  values ('a0000000-0000-4000-8000-000000000007', 20);

set local role authenticated;
set local request.jwt.claim.sub = '40000000-0000-4000-8000-000000000004';
set local request.jwt.claims = '{"sub":"40000000-0000-4000-8000-000000000004","role":"authenticated"}';

select is(public.get_workspace_daily_ai_call_cap('d0000000-0000-4000-8000-000000000004'), 10, 'a member receives the default daily cap');
select is(public.get_workspace_daily_ai_call_cap('f0000000-0000-4000-8000-000000000006'), null::integer, 'a non-member cannot read another workspace daily cap');
select is(public.get_workspace_daily_ai_call_cap('a0000000-0000-4000-8000-000000000007'), 20, 'a workspace override is returned to its member');
select ok(not has_table_privilege('authenticated', 'public.workspace_ai_quota_overrides', 'INSERT'), 'client roles cannot directly mutate daily cap overrides');
select ok(not has_function_privilege('anon', 'public.get_workspace_daily_ai_call_cap(uuid)', 'EXECUTE'), 'anonymous callers cannot execute the daily cap RPC');

set local role service_role;

create temporary table override_quota_reservations (id bigint);
grant select, insert on override_quota_reservations to service_role;
insert into override_quota_reservations(id)
  select public.reserve_workspace_ai_quota('a0000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000004', 'gemini', 'test-model', 0, 1)
  from generate_series(1, 20);
select is((select count(*) from override_quota_reservations where id is not null), 20::bigint, 'a 20-call workspace override accepts twenty atomic reservations');
set local role postgres;
select is((select provider from public.usage_events where id = (select min(id) from override_quota_reservations)), 'gemini', 'a reservation persists normalized Gemini provider attribution');
set local role service_role;
select is(public.reserve_workspace_ai_quota('a0000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000004', 'gemini', 'test-model', 0, 1), null::bigint, 'the twenty-first overridden daily reservation is rejected');

create temporary table quota_reservations (id bigint);
grant select, insert on quota_reservations to service_role;
insert into quota_reservations(id)
  select public.reserve_workspace_ai_quota('d0000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', 'gemini', 'test-model', 0, 1)
  from generate_series(1, 10);
select is((select count(*) from quota_reservations where id is not null), 10::bigint, 'the daily quota accepts the first ten atomic reservations');
select is(public.reserve_workspace_ai_quota('d0000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', 'gemini', 'test-model', 0, 1), null::bigint, 'the eleventh daily reservation is rejected before a provider call');
select is(public.reserve_workspace_ai_quota('f0000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000004', 'gemini', 'test-model', 0, 1), null::bigint, 'a non-member cannot reserve another workspace quota');
select ok(public.reserve_workspace_ai_quota('e0000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000004', 'openai', 'test-model', 4.90, 1) is not null, 'a reservation below the monthly cost cap is accepted');
select is(public.reserve_workspace_ai_quota('e0000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000004', 'openai', 'test-model', 0.20, 1), null::bigint, 'a reservation crossing the monthly cost cap is rejected');
select throws_ok(
  $$select public.reserve_workspace_ai_quota('e0000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000004', 'azure', 'test-model', 0, 1)$$,
  'P0001', 'unsupported AI provider', 'an unsupported provider fails loudly before reservation'
);
select is(public.complete_workspace_usage((select min(id) from quota_reservations), '40000000-0000-4000-8000-000000000004', 100, 50, 150, 0.01), true, 'the owner can record bounded usage for its reservation');

set local role authenticated;

select throws_ok(
  $$select public.record_case_outcome_review('cd000000-0000-4000-8000-000000000004', 'Expected', 'Actual', 'Evidence', 'high', 'Worked', 'Failed', 'Blocked', '', 'Improve', 'Angle', current_date + 7, 'keep', 'Learning', 'Operations → Reviewed outcome → Similar evidence', false)$$,
  'P0001', 'outcome requires next action', 'an outcome without a next action cannot complete the case'
);
select ok(
  public.record_case_outcome_review('cd000000-0000-4000-8000-000000000004', 'Expected', 'Actual', 'Evidence', 'high', 'Worked', 'Failed', 'Blocked', 'Follow up', 'Improve', 'Angle', current_date + 7, 'keep', 'Learning', 'Operations → Reviewed outcome → Similar evidence', false)->>'outcomeId' is not null,
  'a complete outcome review is recorded'
);
select is((select status::text from public.cases where id = 'cd000000-0000-4000-8000-000000000004'), 'completed', 'the case completes only after its outcome review');
select is((select disposition::text from public.learning_records where case_id = 'cd000000-0000-4000-8000-000000000004'), 'keep', 'the outcome creates an explicit learning disposition');
select is(public.confirm_learning_for_reuse((select id from public.learning_records where case_id = 'cd000000-0000-4000-8000-000000000004')), true, 'the user can explicitly confirm reusable learning');

select * from finish();
rollback;
