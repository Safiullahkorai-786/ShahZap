-- Restore Supabase's default API grants for the anon/authenticated roles.
--
-- Symptom: every PostgREST call by the signed-in (authenticated) role returned
-- 404 — tables (messages) and RPCs (report_activity/n). The project's
-- migrations manage RLS + explicit function grants but relied on the dashboard's
-- default table/schema grants, which were lost. RLS policies remain the
-- row-level gatekeeper, so these base grants are safe.
--
-- RPC execute is intentionally granted ONLY to authenticated: this project
-- exhaustively revokes anon on every public function (matching, rewards,
-- reactions, presence, notifications, ...), so we must not restore anon
-- execute on functions here.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select, update on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select, update on sequences to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;
