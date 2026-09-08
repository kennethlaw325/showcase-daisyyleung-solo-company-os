-- Learning signals are soft-deleted so immutable case-learning application
-- snapshots remain available for historical rendering and audit.

alter table public.learning_records
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'learning_records_deletion_fields_consistent'
       and conrelid = 'public.learning_records'::regclass
  ) then
    alter table public.learning_records
      add constraint learning_records_deletion_fields_consistent check (
        (deleted_at is null and deleted_by is null)
        or (deleted_at is not null and deleted_by is not null and approved_for_reuse = false)
      );
  end if;
end $$;

create index if not exists learning_records_active_workspace_created_idx
  on public.learning_records(workspace_id, created_at desc)
  where deleted_at is null;

-- Learning rows are readable only while active.  The service-role-backed
-- server paths can retain history for immutable application snapshots, while
-- authenticated clients receive only active product data through RLS.
drop policy if exists learning_member_select on public.learning_records;
create policy learning_member_select on public.learning_records
  for select using (
    deleted_at is null
    and public.is_workspace_member(workspace_id)
  );

-- There is no direct authenticated table mutation surface for learning rows;
-- confirmation and deletion are both bounded RPCs.
revoke insert, update, delete, truncate, references, trigger
  on table public.learning_records from public, anon, authenticated;
grant select on table public.learning_records to authenticated;

create or replace function public.confirm_learning_for_reuse(p_learning_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare learning_workspace uuid;
begin
  select workspace_id
    into learning_workspace
    from public.learning_records
   where id = p_learning_id
     and disposition <> 'discard'
     and deleted_at is null
   for update;
  if learning_workspace is null or not public.is_workspace_member(learning_workspace) then
    return false;
  end if;
  update public.learning_records
     set approved_for_reuse = true
   where id = p_learning_id
     and workspace_id = learning_workspace
     and deleted_at is null;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (learning_workspace, auth.uid(), 'learning.confirmed', 'learning_record', p_learning_id, '{}');
  return found;
end $$;

-- Delete is deliberately actor/workspace opaque: the verified session is the
-- sole actor input and membership is derived from the locked learning row.
create or replace function public.delete_learning_signal(p_learning_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  learning_row public.learning_records;
  actor_id uuid := auth.uid();
  actor_role public.member_role;
begin
  if p_learning_id is null or actor_id is null then
    return false;
  end if;

  select *
    into learning_row
    from public.learning_records
   where id = p_learning_id
   for update;
  if learning_row.id is null then
    return false;
  end if;

  select role
    into actor_role
    from public.workspace_members
   where workspace_id = learning_row.workspace_id
     and user_id = actor_id;
  if actor_role is null
     or (learning_row.created_by is distinct from actor_id and actor_role not in ('owner', 'admin')) then
    return false;
  end if;

  -- A repeated authorized delete is a successful no-op and emits no second
  -- audit event. The row lock above serializes concurrent first deletes.
  if learning_row.deleted_at is not null then
    return true;
  end if;

  update public.learning_records
     set approved_for_reuse = false,
         deleted_at = now(),
         deleted_by = actor_id
   where id = learning_row.id
     and workspace_id = learning_row.workspace_id
     and deleted_at is null;
  if not found then
    return true;
  end if;

  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (learning_row.workspace_id, actor_id, 'learning.deleted', 'learning_record', learning_row.id, '{}');
  return true;
end $$;

revoke all on function public.confirm_learning_for_reuse(uuid) from public, anon;
grant execute on function public.confirm_learning_for_reuse(uuid) to authenticated;

revoke all on function public.delete_learning_signal(uuid) from public, anon, service_role;
grant execute on function public.delete_learning_signal(uuid) to authenticated;
