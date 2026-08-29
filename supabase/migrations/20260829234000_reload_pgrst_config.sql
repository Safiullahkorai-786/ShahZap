-- Also reload PostgREST config; the schema view (which caches per-role grants
-- and exposed tables) is rebuilt after a schema or config reload in Supabase.

do $$
begin
  perform pg_notify('pgrst', 'reload config');
end $$;
