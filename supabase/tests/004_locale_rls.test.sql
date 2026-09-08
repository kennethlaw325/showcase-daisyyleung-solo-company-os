begin;
select plan(11);

select has_column('public', 'case_artifacts', 'content_locale', 'artifact revisions capture content locale');
select col_not_null('public', 'case_artifacts', 'content_locale', 'artifact locale is required');
select ok((select column_default is null from information_schema.columns where table_schema = 'public' and table_name = 'case_artifacts' and column_name = 'content_locale'), 'new artifact locale writes are explicit');
select matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'case_artifacts_content_locale_check'), 'en', 'locale constraint permits English');
select matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'case_artifacts_content_locale_check'), 'zh-Hant', 'locale constraint permits Traditional Chinese');
select has_function('public', 'reject_artifact_locale_mutation', 'artifact locale mutation trigger exists');
select matches((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'locale'), 'zh-Hant', 'new profiles default to Traditional Chinese');
select matches((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'workspaces' and column_name = 'default_locale'), 'zh-Hant', 'new workspaces default to Traditional Chinese');
select ok((select relrowsecurity from pg_class where oid = 'public.case_artifacts'::regclass), 'artifact rows retain RLS');
select matches((select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'artifacts_member_select'), 'is_workspace_member', 'artifact reads remain workspace-scoped');
select matches((select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'profiles_self_update'), 'auth.uid', 'profile locale updates remain same-user scoped');

select * from finish();
rollback;
