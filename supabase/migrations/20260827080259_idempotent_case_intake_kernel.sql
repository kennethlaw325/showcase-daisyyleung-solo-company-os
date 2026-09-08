-- Idempotent workflow and case-intake writes.  This migration is additive:
-- historical rows and RPCs remain available while new callers opt in to the
-- explicit idempotent contracts below.

alter table public.workflow_streams
  add column if not exists creation_idempotency_key_hash text
    check (creation_idempotency_key_hash is null or creation_idempotency_key_hash ~ '^[a-f0-9]{64}$');

alter table public.cases
  add column if not exists intake_idempotency_key_hash text
    check (intake_idempotency_key_hash is null or intake_idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  add column if not exists intake_payload_hash text
    check (intake_payload_hash is null or intake_payload_hash ~ '^[a-f0-9]{64}$');

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'cases_intake_idempotency_pair_check'
       and conrelid = 'public.cases'::regclass
  ) then
    alter table public.cases
      add constraint cases_intake_idempotency_pair_check check (
        (intake_idempotency_key_hash is null and intake_payload_hash is null)
        or (intake_idempotency_key_hash is not null and intake_payload_hash is not null)
      );
  end if;
end
$$;

create unique index if not exists workflow_streams_creation_idempotency_idx
  on public.workflow_streams (workspace_id, creation_idempotency_key_hash)
  where creation_idempotency_key_hash is not null;

create unique index if not exists cases_intake_idempotency_idx
  on public.cases (workspace_id, intake_idempotency_key_hash)
  where intake_idempotency_key_hash is not null;

-- The general-flow preset is the only cross-module intake default accepted by
-- the workflow kernel.  All other keys remain the existing allowlist.
create or replace function public.validate_workflow_stream_payload(
  p_name text,
  p_description text,
  p_goal_mode text,
  p_intake_defaults jsonb,
  p_checklist jsonb,
  p_stage_visibility jsonb
) returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  item jsonb;
  key_name text;
  item_id text;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'invalid workflow name'; end if;
  if char_length(coalesce(p_description, '')) > 2000 then raise exception 'invalid workflow description'; end if;
  if p_goal_mode not in ('outcome', 'decision', 'project', 'checklist') then raise exception 'invalid workflow goal mode'; end if;

  if p_intake_defaults is null or jsonb_typeof(p_intake_defaults) <> 'object' or octet_length(p_intake_defaults::text) > 50000 then
    raise exception 'invalid workflow intake defaults';
  end if;
  for key_name in select jsonb_object_keys(p_intake_defaults) loop
    if key_name not in ('schemaVersion', 'flowKey', 'successCriteria', 'workflowGuidance', 'offer', 'leadProfile', 'pipelineContext', 'campaignContext', 'conversionTarget', 'decisionsNeeded', 'owners', 'deadlines', 'sopContext', 'blockers', 'crossFunctionalSignals', 'audiencePreset', 'knowledgeLevel', 'audienceGoal', 'tone', 'format', 'disclosureBoundaries') then
      raise exception 'workflow intake defaults contain an unsupported field';
    end if;
    if key_name = 'flowKey' and (jsonb_typeof(p_intake_defaults -> key_name) <> 'string' or p_intake_defaults ->> key_name <> 'general') then
      raise exception 'workflow intake defaults flowKey must be general';
    end if;
    if jsonb_typeof(p_intake_defaults -> key_name) not in ('string', 'array', 'number') then
      raise exception 'workflow intake defaults must contain bounded text or text lists';
    end if;
    if jsonb_typeof(p_intake_defaults -> key_name) = 'array'
      and exists (select 1 from jsonb_array_elements(p_intake_defaults -> key_name) value where jsonb_typeof(value) <> 'string') then
      raise exception 'workflow intake default lists must contain text';
    end if;
  end loop;

  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array' or jsonb_array_length(p_checklist) > 30 then
    raise exception 'invalid workflow checklist';
  end if;
  for item in select value from jsonb_array_elements(p_checklist) as value loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'id') or not (item ? 'label') or not (item ? 'required')
      or exists (select 1 from jsonb_object_keys(item) key where key not in ('id', 'label', 'required')) then
      raise exception 'workflow checklist items must contain only id, label, and required';
    end if;
    item_id := item ->> 'id';
    if item_id is null or item_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or char_length(trim(item ->> 'label')) not between 1 and 200 or jsonb_typeof(item -> 'required') <> 'boolean' then
      raise exception 'invalid workflow checklist item';
    end if;
  end loop;

  if p_stage_visibility is null or jsonb_typeof(p_stage_visibility) <> 'object' then raise exception 'invalid workflow stage visibility'; end if;
  for key_name in select jsonb_object_keys(p_stage_visibility) loop
    if key_name not in ('intake', 'artifact', 'approval', 'gmail', 'outcome') or jsonb_typeof(p_stage_visibility -> key_name) <> 'boolean' then
      raise exception 'invalid workflow stage visibility';
    end if;
    if key_name <> 'gmail' and (p_stage_visibility -> key_name) <> 'true'::jsonb then
      raise exception 'workflow safety gates cannot be disabled';
    end if;
  end loop;
end
$$;

-- Preserve the existing immutable semantic boundary and include the new
-- provenance columns.  Nulls are retained for all historical rows.
create or replace function public.reject_workflow_stream_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.group_id is distinct from old.group_id
    or new.version is distinct from old.version
    or new.base_module is distinct from old.base_module
    or new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.goal_mode is distinct from old.goal_mode
    or new.intake_defaults is distinct from old.intake_defaults
    or new.checklist is distinct from old.checklist
    or new.stage_visibility is distinct from old.stage_visibility
    or new.content_hash is distinct from old.content_hash
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.creation_idempotency_key_hash is distinct from old.creation_idempotency_key_hash then
    raise exception 'workflow stream versions are immutable';
  end if;
  if old.status = 'archived' and new.status is distinct from old.status then
    raise exception 'archived workflow stream is immutable';
  end if;
  if old.status = 'active' and new.status not in ('active', 'archived') then
    raise exception 'invalid workflow stream status';
  end if;
  return new;
end
$$;

-- Extend the existing case provenance trigger without changing its trigger or
-- its historical error messages for the previously protected fields.
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
     or new.template_version is distinct from old.template_version
     or new.created_by is distinct from old.created_by then
    raise exception 'case template provenance is immutable';
  end if;
  if new.intake_idempotency_key_hash is distinct from old.intake_idempotency_key_hash
     or new.intake_payload_hash is distinct from old.intake_payload_hash then
    raise exception 'case idempotency provenance is immutable';
  end if;
  return new;
end
$$;

-- Client links are checked at the row boundary as well as in the intake RPC.
-- FOR SHARE serializes this check against a concurrent archive/update of the
-- client row.  Existing links are unaffected because the trigger only fires
-- for INSERT or updates that mention workspace_id/client_id.
create or replace function public.enforce_active_case_client_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.clients as client_row
     where client_row.id = new.client_id
       and client_row.workspace_id = new.workspace_id
       and client_row.status = 'active'
     for share
  ) then
    raise exception 'client unavailable';
  end if;

  return new;
end
$$;

create trigger cases_active_client_link_guard
before insert or update of workspace_id, client_id on public.cases
for each row execute function public.enforce_active_case_client_link();

create or replace function public.create_workflow_stream_idempotent(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_base_module public.module_key,
  p_name text,
  p_description text,
  p_goal_mode text,
  p_intake_defaults jsonb,
  p_checklist jsonb,
  p_stage_visibility jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.workflow_streams;
  result public.workflow_streams;
  computed_hash text;
  key_hash text;
  replayed boolean := false;
begin
  if p_workspace_id is null
     or p_actor_id is null
     or p_idempotency_key is null
     or p_base_module is null then
    raise exception 'workflow idempotency input is invalid';
  end if;
  if not exists (
    select 1
      from public.workspace_members as member_row
     where member_row.workspace_id = p_workspace_id
       and member_row.user_id = p_actor_id
  ) then
    raise exception 'workflow not authorized';
  end if;
  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then
    raise exception 'workflow actor mismatch';
  end if;

  perform public.validate_workflow_stream_payload(
    p_name,
    p_description,
    p_goal_mode,
    p_intake_defaults,
    p_checklist,
    p_stage_visibility
  );
  computed_hash := public.workflow_stream_payload_hash(
    p_base_module,
    p_name,
    p_description,
    p_goal_mode,
    p_intake_defaults,
    p_checklist,
    p_stage_visibility
  );
  key_hash := encode(
    extensions.digest(
      convert_to(
        ('workflow_stream:' || p_workspace_id::text || ':' || p_idempotency_key::text),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'workflow_stream:' || p_workspace_id::text || ':' || p_idempotency_key::text,
      0
    )
  );
  select *
    into existing
    from public.workflow_streams
   where workspace_id = p_workspace_id
     and creation_idempotency_key_hash = key_hash
   for update;

  if existing.id is not null then
    if existing.created_by is distinct from p_actor_id then
      raise exception 'workflow idempotency actor conflict';
    end if;
    if existing.content_hash is distinct from computed_hash then
      raise exception 'workflow idempotency payload conflict';
    end if;
    result := existing;
    replayed := true;
  else
    insert into public.workflow_streams(
      workspace_id,
      group_id,
      version,
      base_module,
      name,
      description,
      goal_mode,
      intake_defaults,
      checklist,
      stage_visibility,
      status,
      content_hash,
      created_by,
      creation_idempotency_key_hash
    ) values (
      p_workspace_id,
      extensions.gen_random_uuid(),
      1,
      p_base_module,
      trim(p_name),
      trim(coalesce(p_description, '')),
      p_goal_mode,
      p_intake_defaults,
      p_checklist,
      p_stage_visibility,
      'active',
      computed_hash,
      p_actor_id,
      key_hash
    ) returning * into result;

    insert into public.audit_events(
      workspace_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      p_workspace_id,
      p_actor_id,
      'workflow_stream.created',
      'workflow_stream',
      result.id,
      jsonb_build_object(
        'group_id', result.group_id,
        'version', result.version,
        'content_hash', result.content_hash,
        'base_module', result.base_module::text
      )
    );
  end if;

  return jsonb_build_object(
    'workflow', to_jsonb(result) - 'creation_idempotency_key_hash',
    'replayed', replayed
  );
end
$$;

create or replace function public.create_case_intake_idempotent(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_module public.module_key,
  p_template_version integer,
  p_title text,
  p_brief text,
  p_intake_context jsonb,
  p_source_rows jsonb,
  p_snapshot_payload jsonb,
  p_workflow_stream_id uuid default null,
  p_workflow_stream_version integer default null,
  p_client_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.cases;
  result public.cases;
  stream_row public.workflow_streams;
  client_row public.clients;
  snapshot_row public.case_intake_snapshots;
  source_item jsonb;
  source_kind text;
  storage_path text;
  source_url text;
  filename text;
  mime_type text;
  extraction_status text;
  extracted_text text;
  extraction_error_code text;
  sha256 text;
  byte_size bigint;
  source_count integer := 0;
  source_total_bytes bigint := 0;
  snapshot_hash text;
  payload_hash text;
  key_hash text;
  replayed boolean := false;
  key_name text;
  manifest_item jsonb;
begin
  if p_workspace_id is null
     or p_actor_id is null
     or p_idempotency_key is null
     or p_module is null
     or p_template_version is null
     or p_template_version <= 0
     or p_title is null
     or char_length(trim(p_title)) not between 1 and 200
     or p_brief is null
     or char_length(trim(p_brief)) not between 1 and 20000 then
    raise exception 'invalid case intake';
  end if;
  if not exists (
    select 1
      from public.workspace_members as member_row
     where member_row.workspace_id = p_workspace_id
       and member_row.user_id = p_actor_id
  ) then
    raise exception 'case not authorized';
  end if;
  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then
    raise exception 'case actor mismatch';
  end if;
  if p_intake_context is null
     or jsonb_typeof(p_intake_context) <> 'object'
     or octet_length(p_intake_context::text) > 200000
     or p_intake_context ? 'module'
     or public.jsonb_has_key_recursive(p_intake_context, 'module') then
    raise exception 'invalid case intake context';
  end if;
  if (p_workflow_stream_id is null) <> (p_workflow_stream_version is null) then
    raise exception 'workflow stream id and version are required together';
  end if;

  if p_source_rows is null or jsonb_typeof(p_source_rows) <> 'array' then
    raise exception 'invalid source rows';
  end if;
  if jsonb_array_length(p_source_rows) > 5 then
    raise exception 'source row limit exceeded';
  end if;
  for source_item in select value from jsonb_array_elements(p_source_rows) as value loop
    source_count := source_count + 1;
    if jsonb_typeof(source_item) <> 'object' then
      raise exception 'source rows must contain objects';
    end if;
    for key_name in select jsonb_object_keys(source_item) loop
      if key_name not in (
        'source_kind',
        'storage_path',
        'source_url',
        'filename',
        'mime_type',
        'byte_size',
        'sha256',
        'extraction_status',
        'extracted_text',
        'extraction_error_code'
      ) then
        raise exception 'source row contains an unsupported field';
      end if;
    end loop;
    if not (source_item ? 'source_kind')
       or not (source_item ? 'filename')
       or not (source_item ? 'mime_type')
       or not (source_item ? 'byte_size')
       or not (source_item ? 'extraction_status') then
      raise exception 'source row is missing a required field';
    end if;

    source_kind := source_item->>'source_kind';
    storage_path := nullif(source_item->>'storage_path', '');
    source_url := nullif(source_item->>'source_url', '');
    filename := source_item->>'filename';
    mime_type := source_item->>'mime_type';
    extraction_status := source_item->>'extraction_status';
    extracted_text := source_item->>'extracted_text';
    extraction_error_code := source_item->>'extraction_error_code';
    sha256 := source_item->>'sha256';

    if source_kind not in ('private_upload', 'url', 'pasted')
       or filename is null
       or char_length(trim(filename)) not between 1 and 255
       or mime_type not in (
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'text/plain',
         'text/markdown'
       )
       or extraction_status not in ('pending', 'processing', 'extracted', 'failed') then
      raise exception 'invalid source row';
    end if;
    if jsonb_typeof(source_item->'byte_size') <> 'number'
       or (source_item->>'byte_size') !~ '^[0-9]+$' then
      raise exception 'invalid source byte size';
    end if;
    byte_size := (source_item->>'byte_size')::bigint;
    if byte_size <= 0 or byte_size > 10485760 then
      raise exception 'invalid source byte size';
    end if;
    source_total_bytes := source_total_bytes + byte_size;
    if source_total_bytes > 52428800 then
      raise exception 'source byte limit exceeded';
    end if;
    if source_kind = 'private_upload' and (storage_path is null or source_url is not null) then
      raise exception 'invalid private upload source';
    end if;
    if source_kind = 'url' and (
      source_url is null
      or char_length(source_url) > 2048
      or left(lower(source_url), 8) <> 'https://'
      or storage_path is not null
    ) then
      raise exception 'invalid URL source';
    end if;
    if source_kind = 'pasted' and (storage_path is not null or source_url is not null) then
      raise exception 'invalid pasted source';
    end if;
    if storage_path is not null and char_length(storage_path) > 1024 then
      raise exception 'invalid source storage path';
    end if;
    if sha256 is not null and sha256 !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid source hash';
    end if;
    if extracted_text is not null and octet_length(extracted_text) > 100000 then
      raise exception 'source text limit exceeded';
    end if;
    if extraction_error_code is not null
       and (char_length(extraction_error_code) > 120 or extraction_error_code !~ '^[a-z0-9_]+$') then
      raise exception 'invalid source extraction error';
    end if;
  end loop;

  if p_snapshot_payload is null
     or jsonb_typeof(p_snapshot_payload) <> 'object'
     or octet_length(p_snapshot_payload::text) > 250000
     or p_snapshot_payload->>'schemaVersion' <> '1'
     or not (p_snapshot_payload ? 'title')
     or not (p_snapshot_payload ? 'objective')
     or not (p_snapshot_payload ? 'module')
     or not (p_snapshot_payload ? 'moduleContext')
     or not (p_snapshot_payload ? 'sourceManifest') then
    raise exception 'invalid intake snapshot';
  end if;
  if p_snapshot_payload->>'module' <> p_module::text
     or p_snapshot_payload->>'title' is distinct from trim(p_title)
     or p_snapshot_payload->>'objective' is distinct from trim(p_brief) then
    raise exception 'intake snapshot provenance mismatch';
  end if;
  for key_name in select jsonb_object_keys(p_snapshot_payload) loop
    if key_name not in (
      'schemaVersion',
      'title',
      'objective',
      'module',
      'moduleContext',
      'audience',
      'selectedLearningIds',
      'sourceManifest'
    ) then
      raise exception 'invalid intake snapshot field';
    end if;
  end loop;
  if jsonb_typeof(p_snapshot_payload->'moduleContext') <> 'object'
     or jsonb_typeof(p_snapshot_payload->'sourceManifest') <> 'array'
     or jsonb_array_length(p_snapshot_payload->'sourceManifest') > 5 then
    raise exception 'invalid intake snapshot manifest';
  end if;
  for manifest_item in select value from jsonb_array_elements(p_snapshot_payload->'sourceManifest') as value loop
    if jsonb_typeof(manifest_item) <> 'object'
       or not (manifest_item ? 'kind')
       or not (manifest_item ? 'filename') then
      raise exception 'invalid intake snapshot manifest item';
    end if;
    for key_name in select jsonb_object_keys(manifest_item) loop
      if key_name not in ('kind', 'filename', 'sha256', 'byteSize', 'urlHost') then
        raise exception 'invalid intake snapshot manifest item';
      end if;
    end loop;
    if manifest_item->>'kind' not in ('upload', 'url', 'pasted')
       or char_length(trim(manifest_item->>'filename')) not between 1 and 255 then
      raise exception 'invalid intake snapshot manifest item';
    end if;
    if manifest_item ? 'sha256'
       and manifest_item->>'sha256' is not null
       and manifest_item->>'sha256' !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid intake snapshot manifest hash';
    end if;
    if manifest_item ? 'byteSize'
       and manifest_item->>'byteSize' is not null
       and ((manifest_item->>'byteSize') !~ '^[0-9]+$' or (manifest_item->>'byteSize')::bigint > 10485760) then
      raise exception 'invalid intake snapshot manifest size';
    end if;
    if manifest_item ? 'urlHost'
       and manifest_item->>'urlHost' is not null
       and char_length(manifest_item->>'urlHost') > 255 then
      raise exception 'invalid intake snapshot manifest host';
    end if;
  end loop;

  payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'workspace_id', p_workspace_id::text,
          'module', p_module::text,
          'template_version', p_template_version,
          'title', trim(p_title),
          'brief', trim(p_brief),
          'intake_context', p_intake_context,
          'source_rows', p_source_rows,
          'snapshot_payload', p_snapshot_payload,
          'workflow_stream_id', p_workflow_stream_id,
          'workflow_stream_version', p_workflow_stream_version,
          'client_id', p_client_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  key_hash := encode(
    extensions.digest(
      convert_to(
        ('case_intake:' || p_workspace_id::text || ':' || p_idempotency_key::text),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case_intake:' || p_workspace_id::text || ':' || p_idempotency_key::text,
      0
    )
  );
  select *
    into existing
    from public.cases
   where workspace_id = p_workspace_id
     and intake_idempotency_key_hash = key_hash
   for update;
  if existing.id is not null then
    if existing.created_by is distinct from p_actor_id then
      raise exception 'case idempotency actor conflict';
    end if;
    if existing.intake_payload_hash is distinct from payload_hash then
      raise exception 'case idempotency payload conflict';
    end if;
    result := existing;
    source_count := (
      select count(*)::integer
        from public.source_items as source_row
       where source_row.workspace_id = existing.workspace_id
         and source_row.case_id = existing.id
    );
    replayed := true;
  else
    if p_workflow_stream_id is not null then
      select *
        into stream_row
        from public.workflow_streams
       where id = p_workflow_stream_id
         and workspace_id = p_workspace_id
       for share;
      if stream_row.id is null or stream_row.status <> 'active' then
        raise exception 'workflow stream is unavailable';
      end if;
      if stream_row.version is distinct from p_workflow_stream_version then
        raise exception 'stale workflow stream version';
      end if;
      if stream_row.base_module is distinct from p_module then
        raise exception 'workflow stream module mismatch';
      end if;
    end if;

    -- Lock and check the client before the first write.  The row trigger
    -- repeats this check at INSERT/UPDATE, protecting direct writes and
    -- archive races.  Replay returns above before this mutable-state check.
    if p_client_id is not null then
      select *
        into client_row
        from public.clients
       where id = p_client_id
         and workspace_id = p_workspace_id
         and status = 'active'
       for share;
      if client_row.id is null then
        raise exception 'client unavailable';
      end if;
    end if;

    insert into public.cases(
      workspace_id,
      module,
      template_key,
      template_version,
      title,
      brief,
      intake_context,
      status,
      current_revision,
      created_by,
      workflow_stream_id,
      workflow_stream_version,
      workflow_stream_hash,
      client_id,
      intake_idempotency_key_hash,
      intake_payload_hash
    ) values (
      p_workspace_id,
      p_module,
      p_module,
      p_template_version,
      trim(p_title),
      trim(p_brief),
      p_intake_context,
      'draft',
      0,
      p_actor_id,
      p_workflow_stream_id,
      p_workflow_stream_version,
      stream_row.content_hash,
      p_client_id,
      key_hash,
      payload_hash
    ) returning * into result;

    for source_item in select value from jsonb_array_elements(p_source_rows) as value loop
      insert into public.source_items(
        workspace_id,
        case_id,
        source_kind,
        storage_path,
        source_url,
        filename,
        mime_type,
        byte_size,
        sha256,
        extraction_status,
        extracted_text,
        extraction_error_code,
        created_by
      ) values (
        p_workspace_id,
        result.id,
        source_item->>'source_kind',
        nullif(source_item->>'storage_path', ''),
        nullif(source_item->>'source_url', ''),
        trim(source_item->>'filename'),
        source_item->>'mime_type',
        (source_item->>'byte_size')::bigint,
        nullif(source_item->>'sha256', ''),
        source_item->>'extraction_status',
        source_item->>'extracted_text',
        source_item->>'extraction_error_code',
        p_actor_id
      );
    end loop;

    snapshot_hash := encode(
      extensions.digest(convert_to(p_snapshot_payload::text, 'UTF8'), 'sha256'),
      'hex'
    );
    insert into public.case_intake_snapshots(
      workspace_id,
      case_id,
      payload,
      semantic_payload_hash,
      snapshot_status,
      created_by
    ) values (
      p_workspace_id,
      result.id,
      p_snapshot_payload,
      snapshot_hash,
      'exact',
      p_actor_id
    ) returning * into snapshot_row;

    insert into public.audit_events(
      workspace_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      p_workspace_id,
      p_actor_id,
      'case.created',
      'case',
      result.id,
      jsonb_build_object('module', result.module::text, 'intake', true)
    );
    if result.client_id is not null then
      insert into public.audit_events(
        workspace_id,
        actor_id,
        event_type,
        entity_type,
        entity_id,
        metadata
      ) values (
        p_workspace_id,
        p_actor_id,
        'case.client_linked',
        'case',
        result.id,
        jsonb_build_object('client_id', result.client_id)
      );
    end if;
    if result.workflow_stream_id is not null then
      insert into public.audit_events(
        workspace_id,
        actor_id,
        event_type,
        entity_type,
        entity_id,
        metadata
      ) values (
        p_workspace_id,
        p_actor_id,
        'case.workflow_stream_bound',
        'case',
        result.id,
        jsonb_build_object(
          'workflow_stream_id', result.workflow_stream_id,
          'workflow_stream_version', result.workflow_stream_version,
          'workflow_stream_hash', result.workflow_stream_hash,
          'base_module', result.module::text
        )
      );
    end if;
    insert into public.audit_events(
      workspace_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      p_workspace_id,
      p_actor_id,
      'case_intake_snapshot.created',
      'case',
      result.id,
      jsonb_build_object(
        'snapshot_id', (
          snapshot_row.id
        ),
        'snapshot_status', 'exact',
        'semantic_payload_hash', snapshot_hash
      )
    );
  end if;

  return jsonb_build_object(
    'case', to_jsonb(result) - 'intake_idempotency_key_hash' - 'intake_payload_hash',
    'sourceCount', source_count,
    'replayed', replayed
  );
end
$$;

revoke all on function public.enforce_active_case_client_link() from public, anon, authenticated, service_role;
revoke all on function public.create_workflow_stream_idempotent(uuid, uuid, uuid, public.module_key, text, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_case_intake_idempotent(uuid, uuid, uuid, public.module_key, integer, text, text, jsonb, jsonb, jsonb, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_workflow_stream_idempotent(uuid, uuid, uuid, public.module_key, text, text, text, jsonb, jsonb, jsonb)
  to service_role;
grant execute on function public.create_case_intake_idempotent(uuid, uuid, uuid, public.module_key, integer, text, text, jsonb, jsonb, jsonb, uuid, integer, uuid)
  to service_role;
