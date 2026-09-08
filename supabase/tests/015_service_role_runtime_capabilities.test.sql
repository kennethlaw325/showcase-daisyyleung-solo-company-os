begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

-- The capability bridge is intentionally table-specific.  Each row below
-- checks its complete positive/negative ACL shape, including the absence of
-- destructive privileges.
select ok(
  has_table_privilege('service_role', 'public.platform_admins', 'select')
    and not has_table_privilege('service_role', 'public.platform_admins', 'insert')
    and not has_table_privilege('service_role', 'public.platform_admins', 'update')
    and not has_table_privilege('service_role', 'public.platform_admins', 'delete')
    and not has_table_privilege('service_role', 'public.platform_admins', 'truncate'),
  'service role can select platform admins and cannot mutate them'
);
select ok(
  has_table_privilege('service_role', 'public.pilot_applications', 'select')
    and has_table_privilege('service_role', 'public.pilot_applications', 'update')
    and not has_table_privilege('service_role', 'public.pilot_applications', 'insert')
    and not has_table_privilege('service_role', 'public.pilot_applications', 'delete')
    and not has_table_privilege('service_role', 'public.pilot_applications', 'truncate'),
  'service role can select/update pilot applications without insert/delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.workspaces', 'select')
    and has_table_privilege('service_role', 'public.workspaces', 'insert')
    and not has_table_privilege('service_role', 'public.workspaces', 'update')
    and not has_table_privilege('service_role', 'public.workspaces', 'delete')
    and not has_table_privilege('service_role', 'public.workspaces', 'truncate'),
  'service role can select/insert workspaces and cannot update/delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.invitations', 'select')
    and has_table_privilege('service_role', 'public.invitations', 'insert')
    and has_table_privilege('service_role', 'public.invitations', 'update')
    and not has_table_privilege('service_role', 'public.invitations', 'delete')
    and not has_table_privilege('service_role', 'public.invitations', 'truncate'),
  'service role can select/insert/update invitations without delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.profiles', 'select')
    and has_table_privilege('service_role', 'public.profiles', 'update')
    and not has_table_privilege('service_role', 'public.profiles', 'insert')
    and not has_table_privilege('service_role', 'public.profiles', 'delete')
    and not has_table_privilege('service_role', 'public.profiles', 'truncate'),
  'service role can select/update profiles without insert/delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.audit_events', 'insert')
    and not has_table_privilege('service_role', 'public.audit_events', 'select')
    and not has_table_privilege('service_role', 'public.audit_events', 'update')
    and not has_table_privilege('service_role', 'public.audit_events', 'delete')
    and not has_table_privilege('service_role', 'public.audit_events', 'truncate'),
  'service role can insert content-free audit events without read/delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.cases', 'select')
    and has_table_privilege('service_role', 'public.cases', 'insert')
    and not has_table_privilege('service_role', 'public.cases', 'update')
    and not has_table_privilege('service_role', 'public.cases', 'delete')
    and not has_table_privilege('service_role', 'public.cases', 'truncate'),
  'service role can select/insert cases without update/delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.source_items', 'select')
    and has_table_privilege('service_role', 'public.source_items', 'insert')
    and has_table_privilege('service_role', 'public.source_items', 'update')
    and not has_table_privilege('service_role', 'public.source_items', 'delete')
    and not has_table_privilege('service_role', 'public.source_items', 'truncate'),
  'service role can select/insert/update source items without delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.execution_runs', 'select')
    and has_table_privilege('service_role', 'public.execution_runs', 'insert')
    and has_table_privilege('service_role', 'public.execution_runs', 'update')
    and not has_table_privilege('service_role', 'public.execution_runs', 'delete')
    and not has_table_privilege('service_role', 'public.execution_runs', 'truncate'),
  'service role can select/insert/update execution runs without delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.case_audience_variants', 'select')
    and has_table_privilege('service_role', 'public.case_audience_variants', 'insert')
    and has_table_privilege('service_role', 'public.case_audience_variants', 'update')
    and not has_table_privilege('service_role', 'public.case_audience_variants', 'delete')
    and not has_table_privilege('service_role', 'public.case_audience_variants', 'truncate'),
  'service role can select/insert/update audience variants without delete/truncate'
);
select ok(
  has_table_privilege('service_role', 'public.learning_records', 'select')
    and has_table_privilege('service_role', 'public.learning_records', 'update')
    and not has_table_privilege('service_role', 'public.learning_records', 'insert')
    and not has_table_privilege('service_role', 'public.learning_records', 'delete')
    and not has_table_privilege('service_role', 'public.learning_records', 'truncate'),
  'service role preserves learning select/update without insert/delete/truncate'
);

select ok(
  has_function_privilege('authenticated', 'public.record_case_outcome_review(uuid,text,text,text,text,text,text,text,text,text,text,date,public.learning_disposition,text,text,boolean)', 'execute')
    and not has_function_privilege('anon', 'public.record_case_outcome_review(uuid,text,text,text,text,text,text,text,text,text,text,date,public.learning_disposition,text,text,boolean)', 'execute')
    and not has_function_privilege('service_role', 'public.record_case_outcome_review(uuid,text,text,text,text,text,text,text,text,text,text,date,public.learning_disposition,text,text,boolean)', 'execute'),
  'only authenticated can execute the atomic outcome review RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.record_case_outcome(uuid,text,text,text,text,text,text,text,text,text,text,date,public.learning_disposition,text)', 'execute')
    and not has_function_privilege('anon', 'public.record_case_outcome(uuid,text,text,text,text,text,text,text,text,text,text,date,public.learning_disposition,text)', 'execute')
    and not has_function_privilege('service_role', 'public.record_case_outcome(uuid,text,text,text,text,text,text,text,text,text,text,date,public.learning_disposition,text)', 'execute'),
  'only authenticated can execute the constrained legacy outcome adapter'
);
select ok(
  not has_table_privilege('anon', 'public.cases', 'insert')
    and not has_table_privilege('anon', 'public.audit_events', 'insert')
    and not has_table_privilege('anon', 'public.execution_runs', 'insert'),
  'anon receives no new runtime write capabilities'
);
select ok(
  not has_table_privilege('authenticated', 'public.cases', 'insert')
    and not has_table_privilege('authenticated', 'public.audit_events', 'insert')
    and not has_table_privilege('authenticated', 'public.execution_runs', 'insert')
    and not has_table_privilege('authenticated', 'public.source_items', 'insert'),
  'authenticated receives no new runtime write capabilities'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.record_case_outcome_review(uuid,text,text,text,text,text,text,text,text,text,text,date,public.learning_disposition,text,text,boolean)'::regprocedure),
  'atomic outcome review RPC is security definer'
);
select ok(
  (select coalesce(array_to_string(proconfig, ','), '') like '%search_path=public%'
     from pg_proc
    where oid = 'public.record_case_outcome_review(uuid,text,text,text,text,text,text,text,text,text,text,date,public.learning_disposition,text,text,boolean)'::regprocedure),
  'atomic outcome review RPC fixes search_path to public'
);

select * from finish();
rollback;
