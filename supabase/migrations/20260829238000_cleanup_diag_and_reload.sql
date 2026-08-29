-- Clean up diagnostic artifacts used during investigation, and re-issue the
-- PostgREST schema-cache reload so per-role table/column visibility is rebuilt
-- (the API still returned 404 for the authenticated role on /messages despite
-- correct grants, indicating its cached schema view was stale).

drop table if exists public.__diag;
drop table if exists public.__diag3;
drop table if exists public.__diag_rpcs;
drop table if exists public.__diag_grants;

do $$
begin
  -- PostgREST reload: schema (rebuild entity/role view) then config.
  perform pg_notify('pgrst', 'reload schema');
  perform pg_notify('pgrst', 'reload config');
end $$;
