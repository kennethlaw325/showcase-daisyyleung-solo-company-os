-- Bind approval and action revisions to the tenant-scoped artifact they approve.
alter table public.case_actions
  add constraint actions_workspace_artifact_revision_fk
  foreign key (workspace_id, case_id, artifact_revision)
  references public.case_artifacts (workspace_id, case_id, revision)
  on delete cascade;

alter table public.case_approvals
  add constraint approvals_workspace_artifact_revision_fk
  foreign key (workspace_id, case_id, artifact_revision)
  references public.case_artifacts (workspace_id, case_id, revision)
  on delete cascade;

-- The legacy quota shim is no longer part of the callable surface.  Keep the
-- historical function object so upgrades never depend on destructive removal.
revoke all on function public.consume_workspace_quota(uuid, integer)
  from public, anon, authenticated, service_role;
