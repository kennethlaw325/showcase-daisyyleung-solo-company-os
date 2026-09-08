-- Provider attribution is immutable reservation metadata.  The historical
-- explicit-actor overload remains as an object for migration compatibility,
-- but no caller may execute it after this boundary.
alter table public.usage_events
  alter column provider drop default;

revoke all on function public.reserve_workspace_ai_quota(uuid, uuid, text, numeric, integer)
  from public, anon, authenticated, service_role;

-- The provider is supplied by the server-side adapter before any quota is
-- reserved.  Only the two configured providers may create usage metadata.
create or replace function public.reserve_workspace_ai_quota(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_provider text,
  p_model text,
  p_estimated_cost_usd numeric,
  p_units integer
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider, '')));
  daily_cap integer;
  day_calls integer;
  month_calls integer;
  month_cost numeric;
  event_id bigint;
begin
  if normalized_provider not in ('gemini', 'openai') then
    raise exception 'unsupported AI provider' using errcode = 'P0001';
  end if;

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

  insert into public.usage_events(workspace_id, user_id, units, provider, model, estimated_cost_usd)
    values (
      p_workspace_id,
      p_actor_id,
      p_units,
      normalized_provider,
      left(coalesce(nullif(trim(p_model), ''), 'unknown'), 120),
      p_estimated_cost_usd * p_units
    )
    returning id into event_id;
  return event_id;
end $$;

revoke all on function public.reserve_workspace_ai_quota(uuid, uuid, text, text, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_workspace_ai_quota(uuid, uuid, text, text, numeric, integer)
  to service_role;
