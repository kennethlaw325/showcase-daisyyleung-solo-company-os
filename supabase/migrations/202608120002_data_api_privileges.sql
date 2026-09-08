-- Explicit Data API privileges for Supabase projects where new tables are not
-- auto-exposed. RLS remains the row boundary; grants define the smaller set of
-- operations that browser session roles can attempt at all.

grant usage on schema public to anon, authenticated;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

-- The public request form can submit a bounded application but cannot read it.
grant insert on table public.pilot_applications to anon, authenticated;

-- Authenticated portal sessions are read-only at the table layer. Mutations of
-- lifecycle state go through the narrowly granted RPCs or controlled server
-- operations so workspace, approval, quota, and outcome invariants are checked.
grant select on table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.invitations,
  public.cases,
  public.case_artifacts,
  public.case_audience_variants,
  public.case_actions,
  public.case_approvals,
  public.case_outcomes,
  public.learning_records,
  public.source_items,
  public.execution_runs,
  public.oauth_connections,
  public.audit_events,
  public.usage_events
to authenticated;

grant update (display_name, locale) on table public.profiles to authenticated;
