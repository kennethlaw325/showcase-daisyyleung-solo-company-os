-- Editing a case never mutates an approved artifact.  This RPC serializes the
-- edit against the case row, creates one immutable N+1 revision, and returns
-- only identifiers and hashes (never source or artifact text) to the caller.
create or replace function public.create_case_revision(
  p_case_id uuid,
  p_expected_revision integer,
  p_content jsonb,
  p_content_locale text,
  p_action jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  previous_artifact public.case_artifacts;
  current_action public.case_actions;
  next_revision integer;
  artifact_id uuid;
  action_id uuid;
  action_payload jsonb;
  artifact_hash text;
  action_hash text;
  recipient text;
begin
  select * into case_row
    from public.cases
   where id = p_case_id
   for update;

  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) then
    raise exception 'not authorized';
  end if;
  if p_expected_revision is null or case_row.current_revision is distinct from p_expected_revision then
    raise exception 'stale case revision';
  end if;
  if case_row.status in ('completed', 'cancelled') then
    raise exception 'case cannot be edited';
  end if;
  if case_row.status not in ('awaiting_approval', 'action_pending', 'outcome_pending') then
    raise exception 'case cannot be edited in its current state';
  end if;

  if jsonb_typeof(p_content) <> 'object'
     or not (p_content ?& array['title', 'summary', 'body', 'next_action'])
     or exists (
       select 1
         from jsonb_object_keys(p_content) as content_key
        where content_key not in ('title', 'summary', 'body', 'next_action')
     )
     or jsonb_typeof(p_content->'title') <> 'string'
     or jsonb_typeof(p_content->'summary') <> 'string'
     or jsonb_typeof(p_content->'body') <> 'string'
     or jsonb_typeof(p_content->'next_action') <> 'string'
     or char_length(trim(coalesce(p_content->>'title', ''))) not between 1 and 200
     or char_length(trim(coalesce(p_content->>'summary', ''))) not between 1 and 20000
     or char_length(trim(coalesce(p_content->>'body', ''))) not between 1 and 100000
     or char_length(trim(coalesce(p_content->>'next_action', ''))) not between 1 and 2000 then
    raise exception 'invalid revision content';
  end if;
  if p_content_locale not in ('en', 'zh-Hant') then
    raise exception 'invalid content locale';
  end if;

  select * into previous_artifact
    from public.case_artifacts
   where case_id = case_row.id
     and workspace_id = case_row.workspace_id
     and revision = case_row.current_revision
   for update;
  if previous_artifact.id is null then
    raise exception 'current artifact unavailable';
  end if;

  select * into current_action
    from public.case_actions
   where case_id = case_row.id
     and workspace_id = case_row.workspace_id
     and artifact_revision = case_row.current_revision
   order by created_at desc
   limit 1
   for update;

  if current_action.id is not null and current_action.status in ('executing', 'executed') then
    raise exception 'action is already executing or executed';
  end if;
  if case_row.status = 'action_pending' and (current_action.id is null or current_action.status <> 'pending') then
    raise exception 'action is not editable';
  end if;
  if case_row.status = 'outcome_pending' then
    if case_row.module <> 'intelligence' then
      raise exception 'completed action cannot be edited';
    end if;
    if current_action.id is not null then
      raise exception 'action is already executing or executed';
    end if;
    if exists (select 1 from public.case_outcomes where case_id = case_row.id and workspace_id = case_row.workspace_id) then
      raise exception 'case outcome already recorded';
    end if;
  end if;

  if case_row.module = 'intelligence' then
    if p_action is not null then raise exception 'intelligence revisions cannot include an external action'; end if;
  else
    if p_action is null then
      if current_action.id is null or current_action.status <> 'pending' then
        raise exception 'exact action payload is required';
      end if;
      action_payload := current_action.payload;
    else
      action_payload := p_action;
    end if;
    if jsonb_typeof(action_payload) <> 'object'
       or not (action_payload ?& array['to', 'subject', 'body'])
       or exists (
         select 1
       from jsonb_object_keys(action_payload) as action_key
          where action_key not in ('to', 'cc', 'bcc', 'subject', 'body', 'thread_id')
       )
       or jsonb_typeof(action_payload->'to') <> 'string'
       or jsonb_typeof(action_payload->'subject') <> 'string'
       or jsonb_typeof(action_payload->'body') <> 'string'
       or char_length(trim(coalesce(action_payload->>'to', ''))) not between 3 and 320
       or position('@' in (action_payload->>'to')) < 2
       or lower(trim(action_payload->>'to')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       or char_length(trim(coalesce(action_payload->>'subject', ''))) not between 1 and 998
       or char_length(trim(coalesce(action_payload->>'body', ''))) not between 1 and 100000 then
      raise exception 'invalid action payload';
    end if;
    if action_payload ? 'cc' then
      if jsonb_typeof(action_payload->'cc') <> 'array'
         or jsonb_array_length(action_payload->'cc') > 20 then
        raise exception 'invalid action payload';
      end if;
      for recipient in select value from jsonb_array_elements_text(action_payload->'cc') as values(value) loop
        if char_length(trim(recipient)) not between 3 and 320
           or lower(trim(recipient)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
          raise exception 'invalid action payload';
        end if;
      end loop;
    end if;
    if action_payload ? 'bcc' then
      if jsonb_typeof(action_payload->'bcc') <> 'array'
         or jsonb_array_length(action_payload->'bcc') > 20 then
        raise exception 'invalid action payload';
      end if;
      for recipient in select value from jsonb_array_elements_text(action_payload->'bcc') as values(value) loop
        if char_length(trim(recipient)) not between 3 and 320
           or lower(trim(recipient)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
          raise exception 'invalid action payload';
        end if;
      end loop;
    end if;
    if action_payload ? 'thread_id'
       and (jsonb_typeof(action_payload->'thread_id') <> 'string'
         or char_length(trim(action_payload->>'thread_id')) > 255) then
      raise exception 'invalid action payload';
    end if;
  end if;

  if p_content = previous_artifact.content
     and (case_row.module = 'intelligence'
       or (current_action.id is not null and action_payload = current_action.payload)) then
    raise exception 'no changes to save';
  end if;

  next_revision := case_row.current_revision + 1;
  artifact_hash := encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.case_artifacts(
    workspace_id, case_id, revision, kind, content, content_hash,
    template_key, template_version, content_locale, created_by
  ) values (
    case_row.workspace_id, case_row.id, next_revision, 'synthesis', p_content, artifact_hash,
    case_row.template_key, case_row.template_version, p_content_locale, auth.uid()
  ) returning id into artifact_id;

  -- The insert trigger revokes prior approvals.  Keep the explicit update
  -- scoped as well so audience records cannot remain current after an edit.
  update public.case_audience_variants
     set stale = true
   where case_id = case_row.id
     and workspace_id = case_row.workspace_id
     and artifact_revision < next_revision
     and stale = false;

  if current_action.id is not null and current_action.status = 'pending' then
    update public.case_actions set status = 'cancelled' where id = current_action.id;
  end if;

  if case_row.module <> 'intelligence' then
    action_hash := encode(extensions.digest(convert_to(action_payload::text, 'UTF8'), 'sha256'), 'hex');
    insert into public.case_actions(
      workspace_id, case_id, artifact_revision, action_type, payload,
      payload_hash, idempotency_key, created_by
    ) values (
      case_row.workspace_id, case_row.id, next_revision, 'gmail.create_draft', action_payload,
      action_hash, gen_random_uuid()::text, auth.uid()
    ) returning id into action_id;
  end if;

  update public.cases
     set title = p_content->>'title', current_revision = next_revision, status = 'awaiting_approval'
   where id = case_row.id and workspace_id = case_row.workspace_id;

  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (
      case_row.workspace_id, auth.uid(), 'case.revision_edited', 'case', case_row.id,
      jsonb_build_object('artifact_revision', next_revision, 'source_revision', case_row.current_revision)
    );

  return jsonb_build_object(
    'case_id', case_row.id,
    'revision', next_revision,
    'artifact_id', artifact_id,
    'artifact_hash', artifact_hash,
    'action_id', action_id,
    'action_payload_hash', action_hash
  );
end;
$$;

-- Both approval paths lock and re-read the case.  The route-level check is a
-- helpful early response, but only this lock closes the edit/approve race.
create or replace function public.approve_case_action(
  p_case_id uuid, p_artifact_revision integer, p_artifact_hash text, p_action_payload_hash text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  result_id uuid;
  case_row public.cases;
begin
  select * into case_row from public.cases where id = p_case_id for update;
  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) then raise exception 'not authorized'; end if;
  if case_row.current_revision is distinct from p_artifact_revision then raise exception 'stale artifact'; end if;
  if case_row.status <> 'awaiting_approval' then raise exception 'case is not awaiting approval'; end if;
  if not exists (
    select 1 from public.case_artifacts
     where case_id = p_case_id and workspace_id = case_row.workspace_id
       and revision = p_artifact_revision and content_hash = p_artifact_hash
  ) then raise exception 'stale artifact'; end if;
  if not exists (
    select 1 from public.case_actions
     where case_id = p_case_id and workspace_id = case_row.workspace_id
       and artifact_revision = p_artifact_revision and payload_hash = p_action_payload_hash and status = 'pending'
  ) then raise exception 'stale action'; end if;
  insert into public.case_approvals(workspace_id, case_id, artifact_revision, artifact_hash, action_payload_hash, approved_by)
    values (case_row.workspace_id, case_row.id, p_artifact_revision, p_artifact_hash, p_action_payload_hash, auth.uid())
    returning id into result_id;
  update public.cases set status = 'action_pending' where id = case_row.id and workspace_id = case_row.workspace_id;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (
      case_row.workspace_id, auth.uid(), 'artifact_approved', 'case', case_row.id,
      jsonb_build_object('artifact_revision', p_artifact_revision)
    );
  return result_id;
end;
$$;

create or replace function public.approve_case_artifact(
  p_case_id uuid, p_artifact_revision integer, p_artifact_hash text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  result_id uuid;
  case_row public.cases;
begin
  select * into case_row
    from public.cases
   where id = p_case_id and module = 'intelligence'
   for update;
  if case_row.id is null or not public.is_workspace_member(case_row.workspace_id) then raise exception 'not authorized'; end if;
  if case_row.current_revision is distinct from p_artifact_revision then raise exception 'stale artifact'; end if;
  if case_row.status <> 'awaiting_approval' then raise exception 'case is not awaiting approval'; end if;
  if not exists (
    select 1 from public.case_artifacts
     where case_id = p_case_id and workspace_id = case_row.workspace_id
       and revision = p_artifact_revision and content_hash = p_artifact_hash
  ) then raise exception 'stale artifact'; end if;
  if exists (
    select 1 from public.case_actions
     where case_id = p_case_id and workspace_id = case_row.workspace_id
       and artifact_revision = p_artifact_revision and status in ('pending', 'executing')
  ) then raise exception 'action approval required'; end if;
  insert into public.case_approvals(workspace_id, case_id, artifact_revision, artifact_hash, action_payload_hash, approved_by)
    values (case_row.workspace_id, case_row.id, p_artifact_revision, p_artifact_hash, null, auth.uid())
    returning id into result_id;
  update public.cases set status = 'outcome_pending' where id = case_row.id and workspace_id = case_row.workspace_id;
  insert into public.audit_events(workspace_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (
      case_row.workspace_id, auth.uid(), 'artifact_approved', 'case', case_row.id,
      jsonb_build_object('artifact_revision', p_artifact_revision)
    );
  return result_id;
end;
$$;

revoke all on function public.create_case_revision(uuid, integer, jsonb, text, jsonb) from public, anon;
grant execute on function public.create_case_revision(uuid, integer, jsonb, text, jsonb) to authenticated;
revoke all on function public.approve_case_action(uuid, integer, text, text) from public, anon;
grant execute on function public.approve_case_action(uuid, integer, text, text) to authenticated;
revoke all on function public.approve_case_artifact(uuid, integer, text) from public, anon;
grant execute on function public.approve_case_artifact(uuid, integer, text) to authenticated;
