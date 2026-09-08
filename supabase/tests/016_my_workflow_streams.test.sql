begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

insert into auth.users (id, email) values
  ('16000000-0000-4000-8000-000000000001', 'workflow-a@example.test'),
  ('16000000-0000-4000-8000-000000000002', 'workflow-b@example.test');
insert into public.workspaces (id, name, slug) values
  ('16000000-0000-4000-8000-000000000011', 'Workflow A', 'workflow-a'),
  ('16000000-0000-4000-8000-000000000012', 'Workflow B', 'workflow-b');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-000000000001', 'owner'),
  ('16000000-0000-4000-8000-000000000012', '16000000-0000-4000-8000-000000000002', 'owner');

select ok(
  not has_table_privilege('authenticated', 'public.workflow_streams', 'insert')
    and not has_table_privilege('authenticated', 'public.workflow_streams', 'update')
    and not has_table_privilege('authenticated', 'public.workflow_streams', 'delete'),
  'browser roles cannot mutate workflow streams directly'
);
select ok(has_table_privilege('authenticated', 'public.workflow_streams', 'select'), 'authenticated members can select workflow streams');

set local role service_role;
select ok(
  (public.create_workflow_stream(
    '16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-000000000001', 'growth',
    'Launch sprint', 'A bounded offer-to-outreach path', 'outcome',
    '{"successCriteria":"Three qualified replies","offer":"Strategy Sprint"}',
    '[{"id":"proof","label":"Confirm the proof point","required":true}]',
    '{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}'
  )).id is not null,
  'a valid workflow stream is created through the kernel'
);
select ok((select status = 'active' and version = 1 and base_module = 'growth' from public.workflow_streams where name = 'Launch sprint'), 'the first stream version is active and module-bound');
set local role postgres;
select ok((select content_hash = public.workflow_stream_payload_hash(base_module, name, description, goal_mode, intake_defaults, checklist, stage_visibility) from public.workflow_streams where name = 'Launch sprint'), 'content hash covers the semantic preset payload');
set local role service_role;
set local role postgres;
select is((select count(*)::integer from public.audit_events where event_type = 'workflow_stream.created' and entity_type = 'workflow_stream'), 1, 'workflow creation writes a bounded audit receipt');
set local role service_role;

select throws_ok(
  $$select public.create_workflow_stream('16000000-0000-4000-8000-000000000011','16000000-0000-4000-8000-000000000001','growth','Bad JSON','x','outcome','[]','[]','{}')$$,
  'P0001', 'invalid workflow intake defaults', 'invalid workflow JSON is rejected'
);
select throws_ok(
  $$select public.create_workflow_stream('16000000-0000-4000-8000-000000000011','16000000-0000-4000-8000-000000000001','growth','Bad checklist','x','outcome','{}','[{"id":"bad key","label":"x","required":true}]','{}')$$,
  'P0001', 'invalid workflow checklist item', 'invalid checklist shape is rejected'
);
select throws_ok(
  $$select public.create_workflow_stream('16000000-0000-4000-8000-000000000011','16000000-0000-4000-8000-000000000001','growth','Disabled approval','x','outcome','{}','[]','{"intake":true,"artifact":true,"approval":false,"gmail":true,"outcome":true}')$$,
  'P0001', 'workflow safety gates cannot be disabled', 'approval cannot be hidden or bypassed by a workflow preset'
);

select ok(
  (public.revise_workflow_stream(
    (select id from public.workflow_streams where name = 'Launch sprint'), 1,
    '16000000-0000-4000-8000-000000000001', 'growth', 'Launch sprint revised',
    'Updated bounded path', 'decision', '{"successCriteria":"One approved decision"}',
    '[{"id":"decision","label":"Name the decision","required":true}]',
    '{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}'
  )).version = 2,
  'a revision creates the next immutable active version'
);
select is((select status from public.workflow_streams where name = 'Launch sprint'), 'archived', 'the previous stream version is archived');
select ok((select status = 'active' and version = 2 from public.workflow_streams where name = 'Launch sprint revised'), 'only the revised stream is active');
select throws_ok(
  $$select public.revise_workflow_stream((select id from public.workflow_streams where name = 'Launch sprint revised'), 1, '16000000-0000-4000-8000-000000000001', 'growth', 'stale', '', 'outcome', '{}', '[]', '{}')$$,
  'P0001', 'stale workflow stream version', 'a stale stream version is rejected'
);
set local role postgres;
select is((select count(*)::integer from public.audit_events where event_type = 'workflow_stream.revised'), 1, 'workflow revision writes a bounded audit receipt');
set local role service_role;

select ok(
  (public.create_case_with_workflow_stream(
    '16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-000000000001', 'growth', 2,
    'Bound case', 'Use the revised workflow', '{"schemaVersion":1,"successCriteria":"One decision"}',
    (select id from public.workflow_streams where name = 'Launch sprint revised'), 2
  )).workflow_stream_version = 2,
  'a case binds the exact active stream version'
);
select is(
  exists (
    select 1 from pg_proc
    where oid = 'public.create_case_with_workflow_stream(uuid, uuid, public.module_key, integer, text, text, jsonb, uuid, integer)'::regprocedure
      and 'authenticated=X/postgres' = any(proacl::text[])
  ),
  true,
  'the workflow case kernel grants execute to the authenticated role'
);
select ok((select c.workflow_stream_hash = s.content_hash and c.workflow_stream_id = s.id from public.cases c join public.workflow_streams s on s.id = c.workflow_stream_id where c.title = 'Bound case'), 'case stores the exact stream hash snapshot');
set local role postgres;
select is((select count(*)::integer from public.audit_events where event_type = 'case.workflow_stream_bound'), 1, 'case binding writes a bounded audit receipt');
set local role service_role;
select throws_ok(
  $$select public.create_case_with_workflow_stream('16000000-0000-4000-8000-000000000011','16000000-0000-4000-8000-000000000001','intelligence',1,'Wrong module','Bad','{}',(select id from public.workflow_streams where name = 'Launch sprint revised'),2)$$,
  'P0001', 'workflow stream module mismatch', 'a case cannot bind a stream from another module'
);

set local role postgres;
select throws_ok(
  $$update public.cases set workflow_stream_version = 99 where title = 'Bound case'$$,
  'P0001', 'case workflow stream binding is immutable', 'a bound case snapshot cannot be changed'
);
select throws_ok(
  $$update public.workflow_streams set name = 'Mutated' where name = 'Launch sprint revised'$$,
  'P0001', 'workflow stream versions are immutable', 'a stream semantic payload cannot be mutated'
);
set local role service_role;
select ok(public.archive_workflow_stream((select id from public.workflow_streams where name = 'Launch sprint revised'), 2, '16000000-0000-4000-8000-000000000001'), 'an active workflow stream can be archived');
select is((select status from public.workflow_streams where name = 'Launch sprint revised'), 'archived', 'archive status persists');
set local role postgres;
select is((select count(*)::integer from public.audit_events where event_type = 'workflow_stream.archived'), 1, 'workflow archive writes a bounded audit receipt');

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000002';
set local request.jwt.claims = '{"sub":"16000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::integer from public.workflow_streams where workspace_id = '16000000-0000-4000-8000-000000000011'), 0, 'cross-workspace members cannot read workflow streams');

select * from finish();
rollback;
