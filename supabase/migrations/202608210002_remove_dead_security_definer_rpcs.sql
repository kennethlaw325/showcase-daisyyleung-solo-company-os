-- Retire the historical signatures without deleting objects that may already
-- exist in an applied migration chain.  Revocation is the durable boundary;
-- later migrations may add a safer replacement signature independently.
revoke all on function public.revoke_case_approvals(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.store_oauth_secret(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_oauth_secret(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.update_oauth_secret(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_oauth_secret(uuid, uuid)
  from public, anon, authenticated, service_role;
