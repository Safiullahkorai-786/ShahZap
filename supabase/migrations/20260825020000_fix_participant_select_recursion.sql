-- HOTFIX: infinite RLS recursion on conversation_participants.
--
-- 20260825010000 introduced participants_conv_select whose USING clause
-- subqueried public.conversation_participants itself. Postgres detects
-- self-referential policy evaluation and raises
--   SQLSTATE 42P17 "infinite recursion detected in policy"
-- for EVERY query touching that table, which broke chat identity,
-- message sends, friend requests and blocking.
--
-- Fix: express the partner-row rule through the existing SECURITY DEFINER
-- helper private.is_conversation_participant(uuid, uuid), which reads the
-- table as its owner (bypassing RLS) and therefore cannot recurse.

drop policy if exists participants_conv_select on public.conversation_participants;
create policy participants_conv_select
  on public.conversation_participants
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    or coalesce(private.is_conversation_participant(conversation_id, auth.uid()), false)
  );
