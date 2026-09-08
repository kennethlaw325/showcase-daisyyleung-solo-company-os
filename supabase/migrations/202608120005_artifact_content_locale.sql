-- Capture the verified profile locale on every immutable artifact revision.
-- Existing revisions predate this field and are safely treated as English.
alter table public.profiles alter column locale set default 'zh-Hant';
alter table public.workspaces alter column default_locale set default 'zh-Hant';

create or replace function public.create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, display_name, locale)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), 'zh-Hant')
  on conflict (id) do nothing;
  return new;
end $$;

alter table public.case_artifacts
  add column if not exists content_locale text;

update public.case_artifacts
   set content_locale = 'en'
 where content_locale is null;

alter table public.case_artifacts
  alter column content_locale set not null;

-- New writes must always provide the verified locale explicitly; English is
-- used only for the one-time legacy backfill above.
alter table public.case_artifacts
  alter column content_locale drop default;

alter table public.case_artifacts
  drop constraint if exists case_artifacts_content_locale_check;

alter table public.case_artifacts
  add constraint case_artifacts_content_locale_check check (content_locale in ('en', 'zh-Hant'));

create or replace function public.reject_artifact_locale_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.content_locale is distinct from new.content_locale then
    raise exception 'artifact content locale is immutable';
  end if;
  return new;
end $$;

drop trigger if exists case_artifacts_content_locale_immutable on public.case_artifacts;
create trigger case_artifacts_content_locale_immutable
before update on public.case_artifacts
for each row execute function public.reject_artifact_locale_mutation();
