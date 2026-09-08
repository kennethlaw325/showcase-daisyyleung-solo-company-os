begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'tenant-a@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'tenant-b@example.test');

insert into public.profiles (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'tenant-a@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'tenant-b@example.test')
on conflict (id) do update set email = excluded.email;

insert into public.workspaces (id, name, slug) values
  ('a0000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a-test'),
  ('b0000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b-test');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('b0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'owner');

insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by) values
  ('ca000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'growth', 'growth', 1, 'Tenant A case', 'A brief', 'awaiting_approval', 1, '10000000-0000-4000-8000-000000000001'),
  ('cb000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'growth', 'growth', 1, 'Tenant B case', 'B brief', 'awaiting_approval', 1, '20000000-0000-4000-8000-000000000002');

insert into public.case_artifacts (workspace_id, case_id, revision, content, content_hash, content_locale, template_key, template_version, created_by) values
  ('a0000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 1, '{"title":"A"}', repeat('a', 64), 'en', 'growth', 1, '10000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000002', 1, '{"title":"B"}', repeat('b', 64), 'en', 'growth', 1, '20000000-0000-4000-8000-000000000002');

insert into public.case_actions (workspace_id, case_id, artifact_revision, action_type, payload, payload_hash, idempotency_key, created_by) values
  ('a0000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 1, 'gmail.create_draft', '{"to":"a@example.test","subject":"A","body":"A"}', repeat('c', 64), 'tenant-a-idempotency-0001', '10000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000002', 1, 'gmail.create_draft', '{"to":"b@example.test","subject":"B","body":"B"}', repeat('d', 64), 'tenant-b-idempotency-0002', '20000000-0000-4000-8000-000000000002');

insert into public.source_items (workspace_id, case_id, source_kind, filename, mime_type, byte_size, extraction_status, extracted_text, created_by) values
  ('a0000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'pasted', 'A notes', 'text/plain', 10, 'extracted', 'A source', '10000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000002', 'pasted', 'B notes', 'text/plain', 10, 'extracted', 'B source', '20000000-0000-4000-8000-000000000002');

insert into public.audit_events (workspace_id, actor_id, event_type, entity_type, entity_id) values
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'test.a', 'case', 'ca000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'test.b', 'case', 'cb000000-0000-4000-8000-000000000002');

insert into storage.objects (bucket_id, name, metadata) values
  ('source-documents', 'a0000000-0000-4000-8000-000000000001/ca000000-0000-4000-8000-000000000001/a.txt', '{"size":"10"}'),
  ('source-documents', 'b0000000-0000-4000-8000-000000000002/cb000000-0000-4000-8000-000000000002/b.txt', '{"size":"10"}');

select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('cases', 'case_artifacts', 'case_actions', 'source_items', 'audit_events')),
  'tenant lifecycle tables have RLS enabled'
);
select ok(has_table_privilege('authenticated', 'public.cases', 'select'), 'authenticated sessions can select RLS-filtered cases');
select ok(not has_table_privilege('authenticated', 'public.cases', 'insert'), 'authenticated sessions cannot insert lifecycle rows directly');
select ok(not has_table_privilege('anon', 'public.pilot_applications', 'insert'), 'anonymous visitors cannot insert pilot applications directly');
select ok(has_function_privilege('service_role', 'public.submit_pilot_application(text,text,text,text,text,text,text,text,uuid,boolean,text,text)', 'execute'), 'service role can submit consented pilot applications through the bounded RPC');
select ok(not has_table_privilege('anon', 'public.pilot_applications', 'select'), 'anonymous visitors cannot read pilot applications');
select is((select public from storage.buckets where id = 'source-documents'), false, 'source documents bucket is private');
select is((select file_size_limit from storage.buckets where id = 'source-documents'), 10485760::bigint, 'source documents bucket enforces the 10 MiB limit');
select is(
  (select allowed_mime_types from storage.buckets where id = 'source-documents'),
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/markdown']::text[],
  'source documents bucket allows only supported document MIME types'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';

select results_eq($$select count(*) from public.workspaces$$, array[1::bigint], 'Tenant A sees one workspace');
select results_eq($$select count(*) from public.cases$$, array[1::bigint], 'Tenant A sees one case');
select results_eq($$select count(*) from public.case_artifacts$$, array[1::bigint], 'Tenant A sees one artifact');
select results_eq($$select count(*) from public.case_actions$$, array[1::bigint], 'Tenant A sees one action');
select results_eq($$select count(*) from public.source_items$$, array[1::bigint], 'Tenant A sees one source');
select results_eq($$select count(*) from public.audit_events$$, array[1::bigint], 'Tenant A sees one audit event');
select results_eq($$select count(*) from storage.objects where bucket_id = 'source-documents'$$, array[1::bigint], 'Tenant A sees one private Storage object');
select results_eq($$select count(*) from public.cases where id = 'cb000000-0000-4000-8000-000000000002'$$, array[0::bigint], 'Tenant A cannot read Tenant B case by id');
select results_eq($$select count(*) from storage.objects where name like 'b0000000-%'$$, array[0::bigint], 'Tenant A cannot read Tenant B Storage object');

set local request.jwt.claim.sub = '20000000-0000-4000-8000-000000000002';
set local request.jwt.claims = '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}';
select results_eq($$select count(*) from public.cases$$, array[1::bigint], 'Tenant B sees only its own case');
select results_eq($$select count(*) from storage.objects where bucket_id = 'source-documents'$$, array[1::bigint], 'Tenant B sees only its own private Storage object');

reset role;
set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{"role":"anon"}';
select ok(not has_table_privilege('anon', 'public.cases', 'select'), 'anonymous visitors have no tenant table privilege');
select throws_ok($$select count(*) from public.cases$$, '42501', 'permission denied for table cases', 'anonymous tenant reads fail closed');

select * from finish();
rollback;
