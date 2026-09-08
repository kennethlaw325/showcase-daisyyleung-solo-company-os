-- Keep remote release-gate tests deterministic across pg_prove connections.
-- The extensions schema is not exposed through the Data API.
create extension if not exists pgtap with schema extensions;
