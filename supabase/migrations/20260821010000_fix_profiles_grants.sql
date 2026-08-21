-- Fix: restore DML privileges on public.profiles for the authenticated role.
--
-- Context: The live database had SELECT/INSERT/UPDATE revoked from
-- `authenticated` on public.profiles (only DELETE/REFERENCES/TRIGGER/TRUNCATE
-- remained), producing "permission denied for table profiles" for all
-- client-side and cookie-authenticated server-side access: onboarding upsert,
-- /app, /profile/[id], /friends reads.
--
-- RLS remains the row-level gatekeeper; these grants restore standard
-- Supabase defaults so RLS policies can take effect again.

grant select, insert, update on public.profiles to authenticated;
