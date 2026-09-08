-- Founding-pilot consent contract.
--
-- This migration is additive: historical applications keep NULL consent
-- evidence and the legacy eight-argument function remains present but is no
-- longer executable by any API role. New applications use the twelve-argument
-- service-role-only RPC below as their domain write kernel.

alter table public.pilot_applications
  add column if not exists submission_id uuid,
  add column if not exists consent_policy_version text,
  add column if not exists consent_locale text,
  add column if not exists consented_at timestamptz;

alter table public.pilot_applications
  add constraint pilot_applications_consent_all_or_none check (
    (submission_id is null and consent_policy_version is null and consent_locale is null and consented_at is null)
    or (submission_id is not null and consent_policy_version is not null and consent_locale is not null and consented_at is not null)
  );

alter table public.pilot_applications
  add constraint pilot_applications_consent_locale_check check (consent_locale is null or consent_locale in ('en', 'zh-Hant'));

create unique index if not exists pilot_applications_submission_id_unique
  on public.pilot_applications(submission_id)
  where submission_id is not null;

-- The old function is intentionally retained for migration compatibility, but
-- it cannot create a consent-bearing record and is not a callable API surface.
revoke all on function public.submit_pilot_application(text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.submit_pilot_application(
  p_email text,
  p_name text,
  p_company text,
  p_role text,
  p_goals text,
  p_locale text,
  p_website text,
  p_metadata_hash text,
  p_submission_id uuid,
  p_consent boolean,
  p_consent_policy_version text,
  p_consent_locale text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_id uuid;
  existing public.pilot_applications%rowtype;
  normalized_email text := lower(trim(p_email));
  normalized_name text := trim(p_name);
  normalized_company text := nullif(trim(p_company), '');
  normalized_role text := nullif(trim(p_role), '');
  normalized_goals text := trim(p_goals);
  normalized_website text := nullif(trim(p_website), '');
begin
  if p_email is null or char_length(normalized_email) not between 3 and 320 or position('@' in normalized_email) < 2 then
    raise exception 'invalid application email';
  end if;
  if p_name is null or char_length(normalized_name) not between 1 and 160 then
    raise exception 'invalid application name';
  end if;
  if p_company is not null and char_length(normalized_company) > 200 then raise exception 'invalid application company'; end if;
  if p_role is not null and char_length(normalized_role) > 200 then raise exception 'invalid application role'; end if;
  if p_goals is null or char_length(normalized_goals) not between 1 and 10000 then raise exception 'invalid application goals'; end if;
  if p_locale not in ('en', 'zh-Hant') then raise exception 'invalid application locale'; end if;
  if p_website is not null and char_length(normalized_website) > 2000 then raise exception 'invalid application website'; end if;
  if p_metadata_hash is not null and p_metadata_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid application metadata'; end if;
  if p_submission_id is null then raise exception 'pilot consent submission id is required'; end if;
  if p_consent is distinct from true then raise exception 'pilot consent is required'; end if;
  if p_consent_policy_version is distinct from 'founding-pilot-2026-08-21-v1' then raise exception 'pilot consent policy is inactive'; end if;
  if p_consent_locale is distinct from p_locale or p_consent_locale not in ('en', 'zh-Hant') then raise exception 'pilot consent locale mismatch'; end if;

  -- Serialize concurrent first attempts for this submission UUID before the
  -- idempotency lookup and rate bucket. The built-in text hash gives a stable
  -- bigint key without an extension; the transaction lock is released on exit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_submission_id::text, 0));

  -- Idempotency is checked before the public rate-limit bucket. A retried
  -- submission therefore cannot be denied because its network metadata moved
  -- buckets, while reusing the key for a changed payload fails closed.
  select * into existing
    from public.pilot_applications
   where submission_id = p_submission_id
   for update;
  if existing.id is not null then
    if existing.email is not distinct from normalized_email
      and existing.name is not distinct from normalized_name
      and existing.company is not distinct from normalized_company
      and existing.role is not distinct from normalized_role
      and existing.goals is not distinct from normalized_goals
      and existing.locale is not distinct from p_locale
      and existing.website is not distinct from normalized_website
      and existing.consent_policy_version is not distinct from p_consent_policy_version
      and existing.consent_locale is not distinct from p_consent_locale
    then
      return existing.id;
    end if;
    raise exception 'pilot submission id already used with a different payload';
  end if;

  if p_metadata_hash is not null and not public.consume_public_rate_limit('pilot_application', p_metadata_hash, 5) then
    return null;
  end if;

  insert into public.pilot_applications(
    email, name, company, role, goals, locale, website, metadata_hash, status,
    submission_id, consent_policy_version, consent_locale, consented_at
  ) values (
    normalized_email, normalized_name, normalized_company, normalized_role,
    normalized_goals, p_locale, normalized_website, p_metadata_hash, 'new',
    p_submission_id, p_consent_policy_version, p_consent_locale, now()
  ) returning id into application_id;

  -- Content-free, first-insertion-only provenance for the consented application.
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (null, null, 'application_submitted', 'pilot_application', application_id, '{}'::jsonb);

  return application_id;
end
$$;

revoke all on function public.submit_pilot_application(text, text, text, text, text, text, text, text, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_pilot_application(text, text, text, text, text, text, text, text, uuid, boolean, text, text)
  to service_role;
