-- Two-sided blocking.
--
-- 1. blocks_owner_select now lets members see rows where THEY are the
--    blocked party too, so the UI can freeze chats in both directions.
--    (Previously only the blocker could read their own entries.)
--
-- 2. messages_insert_participant additionally rejects any new message when a
--    block exists between the sender and the other conversation participant,
--    in either direction. Blocking is therefore enforced by the database, not
--    just hidden in the UI.

drop policy if exists blocks_owner_select on public.blocks;
create policy blocks_owner_select on public.blocks for select to authenticated
  using (blocker_id = auth.uid() or blocked_id = auth.uid());

drop policy if exists messages_insert_participant on public.messages;
create policy messages_insert_participant on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_conversation_participant(conversation_id, auth.uid())
    and not exists (
      select 1
      from public.conversation_participants cp
      join public.blocks b
        on (b.blocker_id = cp.profile_id and b.blocked_id = (select auth.uid()))
        or (b.blocker_id = (select auth.uid()) and b.blocked_id = cp.profile_id)
      where cp.conversation_id = messages.conversation_id
        and cp.profile_id <> (select auth.uid())
    )
  );

-- Live freeze/unfreeze in open chats.
alter publication supabase_realtime add table public.blocks;
