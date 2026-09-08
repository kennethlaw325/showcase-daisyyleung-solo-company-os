-- Harden session-bound client creation and scope reanalysis to new evidence.

create or replace function public.create_client(
  p_workspace_id uuid,
  p_name text,
  p_company text default '',
  p_notes text default '',
  p_contact_metadata jsonb default '{}'::jsonb
) returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.clients;
begin
  if p_workspace_id is null or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  ) then raise exception 'client not authorized'; end if;

  insert into public.clients(workspace_id, name, company, notes, contact_metadata, created_by, updated_by)
  values (p_workspace_id, trim(p_name), trim(coalesce(p_company, '')), coalesce(p_notes, ''), coalesce(p_contact_metadata, '{}'::jsonb), auth.uid(), auth.uid())
  returning * into result;

  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
  values (p_workspace_id, auth.uid(), 'client.created', 'client', result.id, jsonb_build_object('status', result.status));
  return result;
end $$;

create or replace function public.enqueue_reanalysis_on_source_extraction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  state_hash text;
begin
  if new.extraction_status = 'extracted' then
    if tg_op = 'UPDATE' and old.extraction_status is not distinct from new.extraction_status then return new; end if;
    select * into case_row from public.cases where id = new.case_id;
    -- Revision-zero evidence is initial intake, not newly arriving information.
    if case_row.id is not null and case_row.current_revision > 0 then
      state_hash := public.case_source_state_hash(new.case_id);
      insert into public.case_reanalysis_requests(
        workspace_id, case_id, trigger_type, source_state_hash,
        base_revision, actor_id, idempotency_key
      ) values (
        new.workspace_id, new.case_id, 'source_added', state_hash,
        case_row.current_revision, new.created_by,
        'reanalysis:' || new.case_id::text || ':' || state_hash
      ) on conflict (workspace_id, idempotency_key) do nothing;
    end if;
  end if;
  return new;
end $$;

do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'create_client'
       and pg_get_function_identity_arguments(p.oid)
         = 'p_name text, p_company text, p_notes text, p_contact_metadata jsonb'
  ) then
    revoke all on function public.create_client(text, text, text, jsonb)
      from public, anon, authenticated, service_role;
  end if;
end $$;
revoke all on function public.create_client(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_client(uuid, text, text, text, jsonb)
  to authenticated, service_role;
