begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

select has_table('public', 'case_intake_snapshots', 'immutable intake snapshots table exists');
select has_table('public', 'writing_style_profiles', 'workspace writing style profiles table exists');
select has_table('public', 'artifact_edit_signals', 'revision-scoped edit signals table exists');
select has_table('public', 'clients', 'tenant clients table exists');
select has_table('public', 'case_reanalysis_requests', 'deduplicated reanalysis requests table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.case_intake_snapshots'::regclass), 'intake snapshots have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.clients'::regclass), 'clients have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.case_reanalysis_requests'::regclass), 'reanalysis requests have RLS enabled');
select ok(exists (select 1 from pg_trigger where tgname = 'case_intake_snapshots_immutable'), 'intake snapshots reject mutation');
select ok(exists (select 1 from pg_trigger where tgname = 'source_items_enqueue_reanalysis'), 'source extraction queues reanalysis without invoking AI');
select ok(exists (select 1 from pg_indexes where indexname = 'case_reanalysis_one_open_state_idx'), 'one open request per source state is indexed');
select ok((select prosecdef from pg_proc where oid = 'public.record_case_intake_snapshot(uuid,uuid,jsonb,text)'::regprocedure), 'snapshot writer is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.resolve_artifact_edit_signal(uuid,uuid,text,jsonb)'::regprocedure), 'style confirmation writer is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.create_client(uuid,text,text,text,jsonb)'::regprocedure), 'client writer is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.enqueue_case_reanalysis(uuid,uuid,text,text,integer,text)'::regprocedure), 'reanalysis enqueue writer is security definer');
select ok((select coalesce(array_to_string(proconfig, ','), '') like '%search_path=public%' from pg_proc where oid = 'public.record_case_intake_snapshot(uuid,uuid,jsonb,text)'::regprocedure), 'snapshot writer fixes search path');
select ok((select coalesce(array_to_string(proconfig, ','), '') like '%search_path=public%' from pg_proc where oid = 'public.create_client(uuid,text,text,text,jsonb)'::regprocedure), 'client writer fixes search path');
select ok(not has_table_privilege('authenticated', 'public.clients', 'insert') and not has_table_privilege('authenticated', 'public.clients', 'update') and not has_table_privilege('authenticated', 'public.clients', 'delete'), 'clients are writable only through RPC');
select ok(not has_table_privilege('anon', 'public.case_reanalysis_requests', 'select'), 'anonymous users cannot read reanalysis requests');

select * from finish();
rollback;
