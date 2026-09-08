-- Structured, module-specific intake is authoritative metadata on a case.
-- Legacy rows retain the empty-object sentinel and continue on the v1 path.
alter table public.cases
  add column if not exists intake_context jsonb not null default '{}'::jsonb;

update public.cases
   set intake_context = '{}'::jsonb
 where intake_context is null;

alter table public.cases
  alter column intake_context set default '{}'::jsonb,
  alter column intake_context set not null;

create or replace function public.jsonb_has_key_recursive(value jsonb, needle text)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog, public
as $$
declare
  child jsonb;
begin
  if jsonb_typeof(value) = 'object' then
    if value ? needle then return true; end if;
    for child in select item.value from jsonb_each(value) as item loop
      if public.jsonb_has_key_recursive(child, needle) then return true; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for child in select item from jsonb_array_elements(value) as item loop
      if public.jsonb_has_key_recursive(child, needle) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

revoke all on function public.jsonb_has_key_recursive(jsonb, text) from public, anon, authenticated;
grant execute on function public.jsonb_has_key_recursive(jsonb, text) to service_role;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'cases_intake_context_valid'
       and conrelid = 'public.cases'::regclass
  ) then
    alter table public.cases
      add constraint cases_intake_context_valid check (
        jsonb_typeof(intake_context) = 'object'
        and octet_length(intake_context::text) <= 200000
        and not (intake_context ? 'module')
        and not public.jsonb_has_key_recursive(intake_context, 'module')
      );
  end if;
end $$;

create or replace function public.reject_case_intake_context_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.intake_context is distinct from old.intake_context then
    raise exception 'case intake context is immutable';
  end if;
  if new.module is distinct from old.module
     or new.template_key is distinct from old.template_key
     or new.template_version is distinct from old.template_version then
    raise exception 'case template provenance is immutable';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgname = 'cases_intake_context_immutable'
       and tgrelid = 'public.cases'::regclass
  ) then
    create trigger cases_intake_context_immutable
      before update on public.cases
      for each row execute function public.reject_case_intake_context_mutation();
  end if;
end $$;
