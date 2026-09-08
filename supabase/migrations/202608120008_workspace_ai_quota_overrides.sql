-- Authoritative per-workspace AI daily caps. The table is intentionally not
-- exposed to client roles; authenticated callers use the membership-checked
-- RPC below, while controlled server operations may manage overrides.
create table public.workspace_ai_quota_overrides (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  daily_call_cap integer not null check (daily_call_cap between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspace_ai_quota_overrides_touch_updated_at
before update on public.workspace_ai_quota_overrides
for each row execute function public.touch_updated_at();

alter table public.workspace_ai_quota_overrides enable row level security;
revoke all on table public.workspace_ai_quota_overrides from public, anon, authenticated;
grant all on table public.workspace_ai_quota_overrides to service_role;

create or replace function public.get_workspace_daily_ai_call_cap(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_workspace_member(p_workspace_id) then coalesce(
      (select daily_call_cap from public.workspace_ai_quota_overrides where workspace_id = p_workspace_id),
      10
    )
    else null
  end;
$$;

create or replace function public.reserve_workspace_ai_quota(
  p_workspace_id uuid,
  p_model text default 'unknown',
  p_estimated_cost_usd numeric default 0,
  p_units integer default 1
) returns bigint language plpgsql security definer set search_path = public as $$
declare daily_cap integer;
declare day_calls integer;
declare month_calls integer;
declare month_cost numeric;
declare event_id bigint;
begin
  if not public.is_workspace_member(p_workspace_id) or p_units < 1 or p_estimated_cost_usd < 0 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  daily_cap := public.get_workspace_daily_ai_call_cap(p_workspace_id);
  if daily_cap is null then return null; end if;
  select coalesce(sum(units), 0) into day_calls from public.usage_events where workspace_id = p_workspace_id and created_at >= date_trunc('day', now());
  select coalesce(sum(units), 0) into month_calls from public.usage_events where workspace_id = p_workspace_id and created_at >= date_trunc('month', now());
  select coalesce(sum(estimated_cost_usd), 0) into month_cost from public.usage_events where workspace_id = p_workspace_id and created_at >= date_trunc('month', now());
  if day_calls + p_units > daily_cap or month_calls + p_units > 50 or month_cost + (p_estimated_cost_usd * p_units) > 5 then return null; end if;
  insert into public.usage_events(workspace_id, user_id, units, model, estimated_cost_usd)
    values (p_workspace_id, auth.uid(), p_units, left(coalesce(nullif(trim(p_model), ''), 'unknown'), 120), p_estimated_cost_usd * p_units)
    returning id into event_id;
  return event_id;
end $$;

revoke all on function public.get_workspace_daily_ai_call_cap(uuid) from public, anon;
grant execute on function public.get_workspace_daily_ai_call_cap(uuid) to authenticated;
revoke all on function public.reserve_workspace_ai_quota(uuid, text, numeric, integer) from public, anon;
grant execute on function public.reserve_workspace_ai_quota(uuid, text, numeric, integer) to authenticated;
