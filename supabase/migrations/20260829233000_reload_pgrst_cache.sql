-- Reload PostgREST's schema cache so the API grants take effect.
-- PostgREST caches the exposed schema + per-role privileges on startup; newly
-- granted privileges are not visible until it reloads. Without this, the API
-- kept returning 404 even after the grants were applied.

drop table if exists public.__diag_grants;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
end $$;
