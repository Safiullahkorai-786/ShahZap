-- Fix: restore the missing per-user UPDATE policy on public.profiles.
--
-- Context: The live database evolved past the repository migrations and
-- replaced the original profiles_select/profiles_update policies with
-- profiles_public_discovery (SELECT only). With RLS enabled and no UPDATE
-- policy, client-side upserts from /onboarding (and any profile edits)
-- fail for existing rows, because an UPSERT that matches an existing row
-- requires UPDATE privileges under RLS.
--
-- This migration restores the intended ownership rule from
-- 20260819000100_step_1_foundation.sql: users may update their own profile,
-- and only their own.

drop policy if exists profiles_update on public.profiles;

create policy profiles_update
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
