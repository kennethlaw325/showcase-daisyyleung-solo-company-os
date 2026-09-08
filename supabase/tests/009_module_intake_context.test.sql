begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000009', 'intake-a@example.test'),
  ('30000000-0000-4000-8000-000000000010', 'intake-b@example.test');
insert into public.workspaces (id, name, slug) values
  ('c0000000-0000-4000-8000-000000000009', 'Intake A', 'intake-context-a'),
  ('c0000000-0000-4000-8000-000000000010', 'Intake B', 'intake-context-b');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('c0000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000009', 'owner'),
  ('c0000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000010', 'owner');
insert into public.cases (id, workspace_id, module, template_key, template_version, intake_context, title, brief, status, current_revision, created_by)
values
  ('cc000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000009', 'growth', 'growth', 2,
   '{"schemaVersion":1,"successCriteria":"Three qualified replies","offer":"Strategy Sprint","leadProfile":"Founders with a delayed launch","conversionTarget":"Three qualified conversations"}',
   'Intake A case', 'Growth intake', 'draft', 0, '30000000-0000-4000-8000-000000000009'),
  ('cc000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000010', 'operations', 'operations', 2,
  '{"schemaVersion":1,"successCriteria":"One decision","decisionsNeeded":["Confirm owner"],"owners":[],"deadlines":[],"blockers":[],"crossFunctionalSignals":[]}',
   'Intake B case', 'Operations intake', 'draft', 0, '30000000-0000-4000-8000-000000000010');
insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by)
values ('cc000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000009', 'intelligence', 'intelligence', 1, 'Legacy intake case', 'Legacy', 'draft', 0, '30000000-0000-4000-8000-000000000009');

select throws_ok(
  $$insert into public.cases (workspace_id, module, template_key, template_version, intake_context, title, brief, created_by)
    values ('c0000000-0000-4000-8000-000000000009', 'growth', 'growth', 2, '{"module":"operations"}', 'Bad module context', 'Bad', '30000000-0000-4000-8000-000000000009')$$,
  '23514', 'new row for relation "cases" violates check constraint "cases_intake_context_valid"',
  'a module key in structured context is rejected by the database constraint'
);
select throws_ok(
  $$insert into public.cases (workspace_id, module, template_key, template_version, intake_context, title, brief, created_by)
    values ('c0000000-0000-4000-8000-000000000009', 'growth', 'growth', 2, '{"focus":{"module":"operations"}}', 'Nested module context', 'Bad', '30000000-0000-4000-8000-000000000009')$$,
  '23514', 'new row for relation "cases" violates check constraint "cases_intake_context_valid"',
  'nested module keys are rejected by the database constraint'
);
select throws_ok(
  $$insert into public.cases (workspace_id, module, template_key, template_version, intake_context, title, brief, created_by)
    values ('c0000000-0000-4000-8000-000000000009', 'growth', 'growth', 2, jsonb_build_object('large', repeat('x', 200001)), 'Large context', 'Bad', '30000000-0000-4000-8000-000000000009')$$,
  '23514', 'new row for relation "cases" violates check constraint "cases_intake_context_valid"',
  'oversized structured context is rejected by the database constraint'
);
select throws_ok(
  $$update public.cases set intake_context = intake_context || '{"offer":"changed"}' where id = 'cc000000-0000-4000-8000-000000000009'$$,
  'P0001', 'case intake context is immutable',
  'structured intake context cannot be changed after case creation'
);

select throws_ok(
  $$update public.cases set module = 'operations', template_key = 'operations' where id = 'cc000000-0000-4000-8000-000000000009'$$,
  'P0001', 'case template provenance is immutable',
  'the authoritative module and template provenance cannot be changed'
);

set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-4000-8000-000000000009';
set local request.jwt.claims = '{"sub":"30000000-0000-4000-8000-000000000009","role":"authenticated"}';

select is(
  (select intake_context->>'offer' from public.cases where id = 'cc000000-0000-4000-8000-000000000009'),
  'Strategy Sprint',
  'a workspace member can read its own structured intake context'
);
select is(
  (select intake_context from public.cases where id = 'cc000000-0000-4000-8000-000000000011'),
  '{}'::jsonb,
  'legacy cases default to an empty structured context'
);
select is(
  (select count(*)::integer from public.cases where id = 'cc000000-0000-4000-8000-000000000010'),
  0,
  'cross-workspace members cannot read another workspace case context'
);
select throws_ok(
  $$update public.cases set title = 'Nope' where id = 'cc000000-0000-4000-8000-000000000010'$$,
  '42501', 'permission denied for table cases',
  'a workspace member cannot update another workspace case'
);
select is(
  has_table_privilege('authenticated', 'public.cases', 'UPDATE'),
  false,
  'browser roles cannot update cases directly'
);
select is(
  (select intake_context->>'schemaVersion' from public.cases where id = 'cc000000-0000-4000-8000-000000000009'),
  '1',
  'structured intake retains its explicit schema version'
);
select is(
  (select intake_context ? 'module' from public.cases where id = 'cc000000-0000-4000-8000-000000000009'),
  false,
  'the authoritative module is not duplicated inside structured context'
);

select * from finish();
rollback;
