begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(56);

insert into auth.users (id, email) values
  ('18000000-0000-4000-8000-000000000001', 'idempotent-a@example.test'),
  ('18000000-0000-4000-8000-000000000002', 'idempotent-b@example.test'),
  ('18000000-0000-4000-8000-000000000003', 'idempotent-c@example.test');
insert into public.workspaces (id, name, slug) values
  ('18000000-0000-4000-8000-000000000011', 'Idempotent A', 'idempotent-a'),
  ('18000000-0000-4000-8000-000000000012', 'Idempotent B', 'idempotent-b');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', 'owner'),
  ('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000002', 'member'),
  ('18000000-0000-4000-8000-000000000012', '18000000-0000-4000-8000-000000000003', 'owner');
insert into public.clients (id, workspace_id, name, status, created_by, updated_by) values
  ('18000000-0000-4000-8000-000000000101', '18000000-0000-4000-8000-000000000011', 'Active client', 'active', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001'),
  ('18000000-0000-4000-8000-000000000102', '18000000-0000-4000-8000-000000000011', 'Archived client', 'archived', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000001'),
  ('18000000-0000-4000-8000-000000000103', '18000000-0000-4000-8000-000000000012', 'Cross-workspace client', 'active', '18000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000003');

select has_column('public', 'workflow_streams', 'creation_idempotency_key_hash', 'workflow creation provenance column exists');
select has_column('public', 'cases', 'intake_idempotency_key_hash', 'case intake idempotency key column exists');
select has_column('public', 'cases', 'intake_payload_hash', 'case intake payload column exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'workflow_streams_creation_idempotency_idx'), 'workflow idempotency partial index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'cases_intake_idempotency_idx'), 'case idempotency partial index exists');
select ok((select pg_get_expr(i.indpred, i.indrelid) like '%creation_idempotency_key_hash IS NOT NULL%' from pg_index i where i.indexrelid = 'public.workflow_streams_creation_idempotency_idx'::regclass), 'workflow idempotency index excludes legacy null provenance');
select ok((select pg_get_expr(i.indpred, i.indrelid) like '%intake_idempotency_key_hash IS NOT NULL%' from pg_index i where i.indexrelid = 'public.cases_intake_idempotency_idx'::regclass), 'case idempotency index excludes legacy null provenance');

set local role service_role;

select is(
  (public.create_workflow_stream_idempotent(
    '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000201',
    'growth', 'General flow', 'A bounded flow', 'outcome', '{"flowKey":"general","successCriteria":"One reply"}',
    '[{"id":"proof","label":"Confirm proof","required":true}]', '{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}'
  )->>'replayed'),
  'false',
  'first workflow idempotent write is not a replay'
);
select is(
  (public.create_workflow_stream_idempotent(
    '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000201',
    'growth', 'General flow', 'A bounded flow', 'outcome', '{"flowKey":"general","successCriteria":"One reply"}',
    '[{"id":"proof","label":"Confirm proof","required":true}]', '{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}'
  )->>'replayed'),
  'true',
  'same workflow key and payload replay the original row'
);
select is((select count(*)::integer from public.workflow_streams where workspace_id = '18000000-0000-4000-8000-000000000011' and creation_idempotency_key_hash is not null), 1, 'workflow replay creates one stream row');
set local role postgres;
select is((select count(*)::integer from public.audit_events where workspace_id = '18000000-0000-4000-8000-000000000011' and event_type = 'workflow_stream.created'), 1, 'workflow replay creates one audit');
select ok(
  not exists (select 1 from public.workflow_streams s where to_jsonb(s)::text like '%18000000-0000-4000-8000-000000000201%')
    and not exists (select 1 from public.audit_events where metadata::text like '%18000000-0000-4000-8000-000000000201%'),
  'workflow rows and audits do not expose the raw idempotency UUID'
);
set local role service_role;
select is((public.create_workflow_stream_idempotent(
  '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000201',
  'growth', 'General flow', 'A bounded flow', 'outcome', '{"flowKey":"general","successCriteria":"One reply"}',
  '[{"id":"proof","label":"Confirm proof","required":true}]', '{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}'
)->'workflow') ? 'creation_idempotency_key_hash', false, 'workflow response omits internal provenance hash');
select throws_ok(
  $$select public.create_workflow_stream_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000201','growth','General flow changed','A bounded flow','outcome','{"flowKey":"general","successCriteria":"One reply"}','[{"id":"proof","label":"Confirm proof","required":true}]','{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}')$$,
  'P0001', 'workflow idempotency payload conflict', 'same workflow key with changed payload fails closed'
);
select throws_ok(
  $$select public.create_workflow_stream_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000201','growth','General flow','A bounded flow','outcome','{"flowKey":"general","successCriteria":"One reply"}','[{"id":"proof","label":"Confirm proof","required":true}]','{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}')$$,
  'P0001', 'workflow idempotency actor conflict', 'same workflow key with another actor fails closed'
);
select throws_ok(
  $$select public.create_workflow_stream_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000202','growth','Invalid flow key','','outcome','{"flowKey":"other"}','[]','{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}')$$,
  'P0001', 'workflow intake defaults flowKey must be general', 'workflow defaults reject non-general flow keys'
);
select throws_ok(
  $$select public.create_workflow_stream_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000203','growth','Unknown field','','outcome','{"unknown":"no"}','[]','{"intake":true,"artifact":true,"approval":true,"gmail":false,"outcome":true}')$$,
  'P0001', 'workflow intake defaults contain an unsupported field', 'workflow defaults continue rejecting unknown keys'
);

select is(
  (public.create_case_intake_idempotent(
    '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000301',
    'growth', 1, 'Idempotent case', 'A bounded case', '{"schemaVersion":1,"successCriteria":"One reply"}',
    '[{"source_kind":"pasted","filename":"intake.txt","mime_type":"text/plain","byte_size":5,"extraction_status":"extracted","extracted_text":"hello"}]',
    '{"schemaVersion":1,"title":"Idempotent case","objective":"A bounded case","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',
    null, null, '18000000-0000-4000-8000-000000000101'
  )->>'replayed'),
  'false',
  'first case intake write is not a replay'
);
select is(
  (public.create_case_intake_idempotent(
    '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000301',
    'growth', 1, 'Idempotent case', 'A bounded case', '{"schemaVersion":1,"successCriteria":"One reply"}',
    '[{"source_kind":"pasted","filename":"intake.txt","mime_type":"text/plain","byte_size":5,"extraction_status":"extracted","extracted_text":"hello"}]',
    '{"schemaVersion":1,"title":"Idempotent case","objective":"A bounded case","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',
    null, null, '18000000-0000-4000-8000-000000000101'
  )->>'replayed'),
  'true',
  'same case key and payload replay the original row'
);
select is((select count(*)::integer from public.cases where workspace_id = '18000000-0000-4000-8000-000000000011' and intake_idempotency_key_hash is not null), 1, 'case replay creates one case row');
select is((select count(*)::integer from public.source_items where case_id = (select id from public.cases where title = 'Idempotent case')), 1, 'case replay creates no duplicate source rows');
select is((select count(*)::integer from public.case_intake_snapshots where case_id = (select id from public.cases where title = 'Idempotent case')), 1, 'case replay creates no duplicate snapshot');
set local role postgres;
select is((select count(*)::integer from public.audit_events where entity_id = (select id from public.cases where title = 'Idempotent case') and event_type in ('case.created', 'case.client_linked', 'case_intake_snapshot.created')), 3, 'case replay creates only the bounded first-write audits');
update public.clients set status = 'archived' where id = '18000000-0000-4000-8000-000000000101';
set local role service_role;
select is(
  (public.create_case_intake_idempotent(
    '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000301',
    'growth', 1, 'Idempotent case', 'A bounded case', '{"schemaVersion":1,"successCriteria":"One reply"}',
    '[{"source_kind":"pasted","filename":"intake.txt","mime_type":"text/plain","byte_size":5,"extraction_status":"extracted","extracted_text":"hello"}]',
    '{"schemaVersion":1,"title":"Idempotent case","objective":"A bounded case","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',
    null, null, '18000000-0000-4000-8000-000000000101'
  )->>'replayed'),
  'true',
  'an exact retry replays even after the client is archived'
);
select ok(not ((public.create_case_intake_idempotent(
  '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000301',
  'growth', 1, 'Idempotent case', 'A bounded case', '{"schemaVersion":1,"successCriteria":"One reply"}',
  '[{"source_kind":"pasted","filename":"intake.txt","mime_type":"text/plain","byte_size":5,"extraction_status":"extracted","extracted_text":"hello"}]',
  '{"schemaVersion":1,"title":"Idempotent case","objective":"A bounded case","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',
  null, null, '18000000-0000-4000-8000-000000000101'
)->'case') ? 'intake_idempotency_key_hash') and not ((public.create_case_intake_idempotent(
  '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000301',
  'growth', 1, 'Idempotent case', 'A bounded case', '{"schemaVersion":1,"successCriteria":"One reply"}',
  '[{"source_kind":"pasted","filename":"intake.txt","mime_type":"text/plain","byte_size":5,"extraction_status":"extracted","extracted_text":"hello"}]',
  '{"schemaVersion":1,"title":"Idempotent case","objective":"A bounded case","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',
  null, null, '18000000-0000-4000-8000-000000000101'
)->'case') ? 'intake_payload_hash'), 'case response omits internal provenance hashes');
select throws_ok(
  $$select public.create_case_intake_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000301','growth',1,'Changed case','A bounded case','{"schemaVersion":1,"successCriteria":"One reply"}','[{"source_kind":"pasted","filename":"intake.txt","mime_type":"text/plain","byte_size":5,"extraction_status":"extracted","extracted_text":"hello"}]','{"schemaVersion":1,"title":"Changed case","objective":"A bounded case","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',null,null,'18000000-0000-4000-8000-000000000101')$$,
  'P0001', 'case idempotency payload conflict', 'same case key with changed payload fails closed'
);
select throws_ok(
  $$select public.create_case_intake_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000301','growth',1,'Idempotent case','A bounded case','{"schemaVersion":1,"successCriteria":"One reply"}','[{"source_kind":"pasted","filename":"intake.txt","mime_type":"text/plain","byte_size":5,"extraction_status":"extracted","extracted_text":"hello"}]','{"schemaVersion":1,"title":"Idempotent case","objective":"A bounded case","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',null,null,'18000000-0000-4000-8000-000000000101')$$,
  'P0001', 'case idempotency actor conflict', 'same case key with another actor fails closed'
);
select throws_ok(
  $$select public.create_case_intake_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000302','growth',1,'Atomic bad','A bounded case','{"schemaVersion":1,"successCriteria":"One reply"}','[{"source_kind":"pasted","filename":"intake.txt","mime_type":"text/plain","byte_size":5,"extraction_status":"extracted","extracted_text":"late"}]','{"schemaVersion":2,"title":"Atomic bad","objective":"A bounded case","module":"growth","moduleContext":{},"sourceManifest":[]}',null,null,'18000000-0000-4000-8000-000000000101')$$,
  'P0001', 'invalid intake snapshot', 'invalid late snapshot rejects the intake transaction'
);
select is((select count(*)::integer from public.cases where title = 'Atomic bad'), 0, 'invalid snapshot rolls back the case row');
select is((select count(*)::integer from public.source_items where extracted_text = 'late'), 0, 'invalid snapshot rolls back source rows');
select is((select count(*)::integer from public.case_intake_snapshots where payload->>'title' = 'Atomic bad'), 0, 'invalid snapshot leaves no snapshot row');
set local role postgres;
select ok(not exists (select 1 from public.audit_events where metadata::text like '%18000000-0000-4000-8000-000000000301%'), 'idempotent audits never expose the raw key as metadata');
select ok(not exists (select 1 from public.cases c where to_jsonb(c)::text like '%18000000-0000-4000-8000-000000000301%'), 'case rows do not contain the raw idempotency UUID');
set local role service_role;

select is(
  (public.create_case_intake_idempotent(
    '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000307',
    'growth', 1, 'Workflow-bound case', 'Preserve workflow audit provenance', '{"schemaVersion":1,"successCriteria":"One reply"}',
    '[]',
    '{"schemaVersion":1,"title":"Workflow-bound case","objective":"Preserve workflow audit provenance","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',
    (select id from public.workflow_streams where name = 'General flow'), 1, null
  )->>'replayed'),
  'false',
  'first workflow-bound intake is not a replay'
);
select is(
  (public.create_case_intake_idempotent(
    '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000307',
    'growth', 1, 'Workflow-bound case', 'Preserve workflow audit provenance', '{"schemaVersion":1,"successCriteria":"One reply"}',
    '[]',
    '{"schemaVersion":1,"title":"Workflow-bound case","objective":"Preserve workflow audit provenance","module":"growth","moduleContext":{"schemaVersion":1,"successCriteria":"One reply"},"sourceManifest":[]}',
    (select id from public.workflow_streams where name = 'General flow'), 1, null
  )->>'replayed'),
  'true',
  'workflow-bound intake retry replays the original case'
);
set local role postgres;
select is(
  (select count(*)::integer from public.audit_events where entity_id = (select id from public.cases where title = 'Workflow-bound case') and event_type = 'case.workflow_stream_bound'),
  1,
  'workflow-bound intake preserves one first-write workflow audit receipt'
);
set local role service_role;

select throws_ok(
  $$select public.create_case_intake_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000303','growth',1,'Archived client case','A bounded case','{"schemaVersion":1}','[]','{"schemaVersion":1,"title":"Archived client case","objective":"A bounded case","module":"growth","moduleContext":{},"sourceManifest":[]}',null,null,'18000000-0000-4000-8000-000000000102')$$,
  'P0001', 'client unavailable', 'archived clients are rejected by intake'
);
select throws_ok(
  $$select public.create_case_intake_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000304','growth',1,'Cross client case','A bounded case','{"schemaVersion":1}','[]','{"schemaVersion":1,"title":"Cross client case","objective":"A bounded case","module":"growth","moduleContext":{},"sourceManifest":[]}',null,null,'18000000-0000-4000-8000-000000000103')$$,
  'P0001', 'client unavailable', 'cross-workspace clients are rejected by intake'
);
select throws_ok(
  $$select public.create_case_intake_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000305','growth',1,'Missing client case','A bounded case','{"schemaVersion":1}','[]','{"schemaVersion":1,"title":"Missing client case","objective":"A bounded case","module":"growth","moduleContext":{},"sourceManifest":[]}',null,null,'18000000-0000-4000-8000-000000000199')$$,
  'P0001', 'client unavailable', 'missing clients are rejected by intake'
);
select throws_ok(
  $$select public.create_case_intake_idempotent('18000000-0000-4000-8000-000000000011','18000000-0000-4000-8000-000000000003','18000000-0000-4000-8000-000000000306','growth',1,'Unauthorized case','A bounded case','{"schemaVersion":1}','[]','{"schemaVersion":1,"title":"Unauthorized case","objective":"A bounded case","module":"growth","moduleContext":{},"sourceManifest":[]}',null,null,null)$$,
  'P0001', 'case not authorized', 'an actor outside the workspace cannot create an intake'
);

set local role postgres;
update public.clients set status = 'active' where id = '18000000-0000-4000-8000-000000000101';
select throws_ok(
  $$insert into public.cases (workspace_id, module, template_key, template_version, title, brief, intake_context, created_by, intake_idempotency_key_hash) values ('18000000-0000-4000-8000-000000000011','growth','growth',1,'Pair check','Valid','{"schemaVersion":1}','18000000-0000-4000-8000-000000000001',repeat('a',64))$$,
  '23514', 'new row for relation "cases" violates check constraint "cases_intake_idempotency_pair_check"', 'case intake key and payload hashes are all-or-none'
);
insert into public.cases (workspace_id, module, template_key, template_version, title, brief, intake_context, created_by, client_id)
  values ('18000000-0000-4000-8000-000000000011', 'growth', 'growth', 1, 'Trigger active', 'Valid', '{"schemaVersion":1}', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000101');
select ok(exists (select 1 from public.cases where title = 'Trigger active'), 'the active-client trigger permits a same-workspace active client');
select throws_ok(
  $$insert into public.cases (workspace_id, module, template_key, template_version, title, brief, intake_context, created_by, client_id) values ('18000000-0000-4000-8000-000000000011','growth','growth',1,'Trigger archived','Valid','{"schemaVersion":1}','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000102')$$,
  'P0001', 'client unavailable', 'the active-client trigger rejects an archived client');
select throws_ok(
  $$insert into public.cases (workspace_id, module, template_key, template_version, title, brief, intake_context, created_by, client_id) values ('18000000-0000-4000-8000-000000000011','growth','growth',1,'Trigger cross','Valid','{"schemaVersion":1}','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000103')$$,
  'P0001', 'client unavailable', 'the active-client trigger rejects a cross-workspace client');
select throws_ok(
  $$insert into public.cases (workspace_id, module, template_key, template_version, title, brief, intake_context, created_by, client_id) values ('18000000-0000-4000-8000-000000000011','growth','growth',1,'Trigger missing','Valid','{"schemaVersion":1}','18000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000199')$$,
  'P0001', 'client unavailable', 'the active-client trigger rejects a missing client');

set local role service_role;
select ok((select prosecdef from pg_proc where oid = 'public.enforce_active_case_client_link()'::regprocedure), 'client-link trigger is security definer');
select ok((select coalesce(array_to_string(proconfig, ','), '') like '%search_path=%' from pg_proc where oid = 'public.enforce_active_case_client_link()'::regprocedure), 'client-link trigger fixes an empty search path');
select ok((select prosecdef from pg_proc where oid = 'public.create_workflow_stream_idempotent(uuid,uuid,uuid,public.module_key,text,text,text,jsonb,jsonb,jsonb)'::regprocedure), 'workflow idempotent writer is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.create_case_intake_idempotent(uuid,uuid,uuid,public.module_key,integer,text,text,jsonb,jsonb,jsonb,uuid,integer,uuid)'::regprocedure), 'case idempotent writer is security definer');
select ok((select pg_get_functiondef('public.create_workflow_stream_idempotent(uuid,uuid,uuid,public.module_key,text,text,text,jsonb,jsonb,jsonb)'::regprocedure) like '%pg_advisory_xact_lock%'), 'workflow writer serializes the idempotency key');
select ok((select pg_get_functiondef('public.create_case_intake_idempotent(uuid,uuid,uuid,public.module_key,integer,text,text,jsonb,jsonb,jsonb,uuid,integer,uuid)'::regprocedure) like '%pg_advisory_xact_lock%'), 'case writer serializes the idempotency key');
select ok(has_function_privilege('service_role', 'public.create_workflow_stream_idempotent(uuid,uuid,uuid,public.module_key,text,text,text,jsonb,jsonb,jsonb)', 'execute'), 'service role can execute workflow idempotent writer');
select ok(not has_function_privilege('authenticated', 'public.create_workflow_stream_idempotent(uuid,uuid,uuid,public.module_key,text,text,text,jsonb,jsonb,jsonb)', 'execute'), 'authenticated cannot execute workflow idempotent writer directly');
select ok(has_function_privilege('service_role', 'public.create_case_intake_idempotent(uuid,uuid,uuid,public.module_key,integer,text,text,jsonb,jsonb,jsonb,uuid,integer,uuid)', 'execute'), 'service role can execute case idempotent writer');
select ok(not has_function_privilege('authenticated', 'public.create_case_intake_idempotent(uuid,uuid,uuid,public.module_key,integer,text,text,jsonb,jsonb,jsonb,uuid,integer,uuid)', 'execute'), 'authenticated cannot execute case idempotent writer directly');
select ok(not has_function_privilege('service_role', 'public.enforce_active_case_client_link()', 'execute'), 'client-link trigger has no API execute grant');

select * from finish();
rollback;
