-- Quota RPC security boundary.  Browser sessions may read their own daily cap,
-- but all quota mutations are explicit server-role operations bound to the
-- verified actor supplied by the server route.

-- The historical mutating signatures accepted auth.uid() implicitly (or no
-- actor at all) and are retained only for migration compatibility.  No role,
-- including service_role, may call them directly after this migration.
revoke all on function public.reserve_workspace_ai_quota(uuid, text, numeric, integer) from public, anon, authenticated, service_role;
revoke all on function public.consume_workspace_quota(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_workspace_usage(bigint, integer, integer, integer, numeric) from public, anon, authenticated, service_role;

-- The replacement reserve RPC accepts an explicit actor only from the
-- server-role client.  Membership is checked against that actor (not auth.uid)
-- and the reservation records the same actor as its owner.
create or replace function public.reserve_workspace_ai_quota(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_model text default 'unknown',
  p_estimated_cost_usd numeric default 0,
  p_units integer default 1
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  daily_cap integer;
  day_calls integer;
  month_calls integer;
  month_cost numeric;
  event_id bigint;
begin
  if p_workspace_id is null
     or p_actor_id is null
     or not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = p_workspace_id
          and m.user_id = p_actor_id
     )
     or p_units < 1
     or p_estimated_cost_usd is null
     or p_estimated_cost_usd < 0 then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  select coalesce(
    (select o.daily_call_cap
       from public.workspace_ai_quota_overrides o
      where o.workspace_id = p_workspace_id),
    10
  ) into daily_cap;

  select coalesce(sum(u.units), 0) into day_calls
    from public.usage_events u
   where u.workspace_id = p_workspace_id
     and u.created_at >= date_trunc('day', now());
  select coalesce(sum(u.units), 0) into month_calls
    from public.usage_events u
   where u.workspace_id = p_workspace_id
     and u.created_at >= date_trunc('month', now());
  select coalesce(sum(u.estimated_cost_usd), 0) into month_cost
    from public.usage_events u
   where u.workspace_id = p_workspace_id
     and u.created_at >= date_trunc('month', now());

  if day_calls + p_units > daily_cap
     or month_calls + p_units > 50
     or month_cost + (p_estimated_cost_usd * p_units) > 5 then
    return null;
  end if;

  insert into public.usage_events(workspace_id, user_id, units, model, estimated_cost_usd)
    values (
      p_workspace_id,
      p_actor_id,
      p_units,
      left(coalesce(nullif(trim(p_model), ''), 'unknown'), 120),
      p_estimated_cost_usd * p_units
    )
    returning id into event_id;
  return event_id;
end $$;

revoke all on function public.reserve_workspace_ai_quota(uuid, uuid, text, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_workspace_ai_quota(uuid, uuid, text, numeric, integer)
  to service_role;

-- Completion is likewise server-only and may update only a reservation owned
-- by the explicit actor in the reservation's workspace.
create or replace function public.complete_workspace_usage(
  p_usage_event_id bigint,
  p_actor_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_actual_cost_usd numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_id_value uuid;
  reservation_owner uuid;
begin
  if p_usage_event_id is null or p_actor_id is null then return false; end if;
  select u.workspace_id, u.user_id
    into workspace_id_value, reservation_owner
    from public.usage_events u
   where u.id = p_usage_event_id;
  if workspace_id_value is null
     or reservation_owner is distinct from p_actor_id
     or not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = workspace_id_value
          and m.user_id = p_actor_id
     ) then
    return false;
  end if;

  update public.usage_events u
     set input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
         output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
         total_tokens = greatest(coalesce(p_total_tokens, 0), 0),
         estimated_cost_usd = greatest(coalesce(p_actual_cost_usd, u.estimated_cost_usd), 0)
   where u.id = p_usage_event_id
     and u.workspace_id = workspace_id_value
     and u.user_id = p_actor_id;
  return found;
end $$;

revoke all on function public.complete_workspace_usage(bigint, uuid, integer, integer, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.complete_workspace_usage(bigint, uuid, integer, integer, integer, numeric)
  to service_role;

-- Read-only daily-cap lookup remains available to authenticated sessions only;
-- the RPC itself still checks membership using the verified auth.uid().
revoke all on function public.get_workspace_daily_ai_call_cap(uuid) from public, anon;
grant execute on function public.get_workspace_daily_ai_call_cap(uuid) to authenticated;

-- Trigger-only functions are not browser APIs.
revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;
revoke all on function public.invalidate_approvals_on_new_artifact() from public, anon, authenticated;

-- The remaining trigger-only functions have no direct server callers.  Their
-- trigger invocations continue to run without exposing callable EXECUTE
-- privileges to browser or service roles.
revoke all on function public.refresh_learning_search_document() from public, anon, authenticated, service_role;
revoke all on function public.touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.reject_audit_mutation() from public, anon, authenticated, service_role;
revoke all on function public.reject_artifact_locale_mutation() from public, anon, authenticated, service_role;
revoke all on function public.reject_case_work_packet_mutation() from public, anon, authenticated, service_role;
revoke all on function public.reject_case_intake_context_mutation() from public, anon, authenticated, service_role;

-- Harden all advisor-reported mutable search paths while preserving trigger and
-- predicate semantics.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.consume_workspace_quota(p_workspace_id uuid, p_units integer default 1)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  return public.reserve_workspace_ai_quota(p_workspace_id, 'unknown', 0, p_units) is not null;
end $$;

create or replace function public.storage_source_object_is_valid(p_object_name text, p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_object_name ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,280}$'
    and (p_metadata->>'size') ~ '^[0-9]+$'
    and (p_metadata->>'size')::bigint between 1 and 10485760;
$$;

create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit events are append-only';
end $$;

-- These tables are intentionally policyless internal state.  Keep them out of
-- the browser Data API even if a later migration adds a broad table grant.
revoke all privileges on table public.platform_admins, public.public_rate_limits, public.workspace_ai_quota_overrides
  from public, anon, authenticated;
grant all privileges on table public.workspace_ai_quota_overrides to service_role;

-- Membership predicates are internal authorization helpers.  Authenticated
-- clients may retain required execution for read policies; anonymous and
-- PUBLIC execution is removed explicitly.
revoke all on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
revoke all on function public.is_workspace_admin(uuid) from public, anon;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
