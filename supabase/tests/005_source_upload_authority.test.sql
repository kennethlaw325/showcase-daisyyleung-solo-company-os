begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

insert into auth.users (id, email) values
  ('61000000-0000-4000-8000-000000000001', 'upload-owner@example.test'),
  ('62000000-0000-4000-8000-000000000002', 'upload-outsider@example.test');
insert into public.workspaces (id, name, slug) values
  ('d1000000-0000-4000-8000-000000000001', 'Upload workspace', 'upload-authority-test');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('d1000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'owner');
insert into public.cases (id, workspace_id, module, template_key, template_version, title, brief, status, current_revision, created_by) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'growth', 'growth', 1, 'Upload case', 'Brief', 'draft', 0, '61000000-0000-4000-8000-000000000001');

select ok(
  not has_function_privilege('authenticated', 'public.register_source_item(uuid,uuid,text,text,text,bigint,text)', 'execute'),
  'browser sessions cannot register source rows directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.update_source_extraction(uuid,text,text,text,text)', 'execute'),
  'browser sessions cannot forge extracted prompt text'
);
select ok(
  not has_function_privilege('authenticated', 'public.reserve_source_upload(uuid,uuid,uuid,text,text,text,bigint)', 'execute'),
  'browser sessions cannot reserve upload slots directly'
);
select ok(
  has_function_privilege('service_role', 'public.reserve_source_upload(uuid,uuid,uuid,text,text,text,bigint)', 'execute'),
  'only the trusted server role can reserve upload slots'
);
select ok(
  not has_function_privilege('authenticated', 'public.finalize_source_extraction(uuid,uuid,uuid,uuid,text,text,text,text)', 'execute'),
  'browser sessions cannot finalize source extraction directly'
);
select ok(
  has_function_privilege('service_role', 'public.finalize_source_extraction(uuid,uuid,uuid,uuid,text,text,text,text)', 'execute'),
  'only the trusted server role can finalize source extraction'
);
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT' and policyname = 'source_documents_member_write'),
  0::bigint,
  'direct authenticated Storage insert policy is removed'
);
select ok(
  public.reserve_source_upload(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx',
    'slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 1024
  ) is not null,
  'trusted server reservation accepts PPTX for a verified workspace member and case'
);
select is(
  (
    select mime_type
      from public.source_items
     where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
  ),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'the pending source stores the canonical PPTX MIME type'
);
select throws_ok(
  $$select public.reserve_source_upload(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000003-legacy.ppt',
    'legacy.ppt', 'application/vnd.ms-powerpoint', 1024
  )$$,
  'P0001', 'unsupported source type',
  'legacy binary PPT remains rejected with a bounded cause'
);
select throws_ok(
  $$select public.reserve_source_upload(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002-outsider.pptx',
    'outsider.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 1024
  )$$,
  'P0001', 'not authorized',
  'PPTX reservation still denies a non-member user'
);
select ok(
  public.finalize_source_extraction(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    (
      select id
        from public.source_items
       where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
    ),
    '61000000-0000-4000-8000-000000000001',
    'extracted', repeat('a', 64), 'Slide 1: PPTX source text', null
  ),
  'trusted finalization accepts a bounded extracted PPTX result'
);
select is(
  (
    select extraction_status
      from public.source_items
     where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
  ),
  'extracted',
  'successful finalization records the extracted state'
);
select is(
  (
    select sha256
      from public.source_items
     where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
  ),
  repeat('a', 64),
  'successful finalization binds the extracted content hash'
);
select is(
  (
    select extracted_text
      from public.source_items
     where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
  ),
  'Slide 1: PPTX source text',
  'successful finalization stores the bounded extracted text'
);
select is(
  (
    select metadata
      from public.audit_events
     where event_type = 'source.extraction_completed'
       and entity_id = (
         select id
           from public.source_items
          where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
       )
  ),
  '{"status":"extracted"}'::jsonb,
  'the extraction audit record contains status only and no source content'
);
select ok(
  public.finalize_source_extraction(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    (
      select id
        from public.source_items
       where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
    ),
    '61000000-0000-4000-8000-000000000001',
    'extracted', repeat('a', 64), 'Slide 1: PPTX source text', null
  ),
  'an exact finalization retry is idempotent'
);
select ok(
  not public.finalize_source_extraction(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    (
      select id
        from public.source_items
       where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
    ),
    '61000000-0000-4000-8000-000000000001',
    'extracted', repeat('b', 64), 'Changed text', null
  ),
  'a changed finalization payload cannot overwrite a completed source'
);
select ok(
  not public.finalize_source_extraction(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    (
      select id
        from public.source_items
       where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000001-slides.pptx'
    ),
    '62000000-0000-4000-8000-000000000002',
    'extracted', repeat('a', 64), 'Slide 1: PPTX source text', null
  ),
  'a non-member actor cannot finalize another workspace source'
);
select ok(
  public.reserve_source_upload(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000004-broken.pptx',
    'broken.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 1024
  ) is not null,
  'a second PPTX source can reserve a separate pending slot'
);

insert into public.source_items(
  workspace_id, case_id, source_kind, storage_path, filename, mime_type,
  byte_size, extraction_status, created_by
)
select
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'private_upload',
  'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-00000000001' || slot::text || '-fixture.txt',
  'fixture-' || slot::text || '.txt',
  'text/plain',
  10,
  'pending',
  '61000000-0000-4000-8000-000000000001'
from generate_series(1, 3) as slots(slot);

select ok(
  public.finalize_source_extraction(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    (
      select id
        from public.source_items
       where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000004-broken.pptx'
    ),
    '61000000-0000-4000-8000-000000000001',
    'failed', null, null, 'pptx_parse_failed'
  ),
  'trusted finalization records a bounded PPTX extraction failure'
);
select is(
  (
    select extraction_status || ':' || extraction_error_code
      from public.source_items
     where storage_path = 'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000004-broken.pptx'
  ),
  'failed:pptx_parse_failed',
  'failed finalization exposes a stable content-free recovery code'
);
select ok(
  public.reserve_source_upload(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000020-retry.pptx',
    'retry.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 1024
  ) is not null,
  'a failed upload reservation frees its slot for a retry'
);
select throws_ok(
  $$select public.reserve_source_upload(
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000021-limit.pptx',
    'limit.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 1024
  )$$,
  'P0001', 'source limit reached',
  'a retry still respects the five active-source boundary'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects(bucket_id, name, metadata) values ('source-documents', 'a0000000-0000-4000-8000-000000000001/ca000000-0000-4000-8000-000000000001/bypass.txt', '{"size":"1"}')$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'ordinary authenticated clients cannot bypass signed upload tickets'
);

select * from finish();
rollback;
