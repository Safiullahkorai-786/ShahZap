-- Live presence + read receipts.
--
-- 1) Broadcast profile row updates over Realtime so a partner's heartbeat
--    (last_active_at) flips their online dot in near real time.
--    Guarded: adding an already-published table raises duplicate_object.
--
-- 2) Read receipts: conversation_participants.last_read_at records when a
--    member last had the chat open. Senders compare it against message
--    timestamps to colour the double tick ("seen").
--    * Column grant → members can ONLY ever write last_read_at, on their own row.
--    * New select policy → conversation partners may read each other's rows
--      (previously strictly self-select), limited to shared conversations.

do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
end $$;

alter table public.conversation_participants add column if not exists last_read_at timestamptz;

revoke update on public.conversation_participants from authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;

drop policy if exists participants_self_update on public.conversation_participants;
create policy participants_self_update
  on public.conversation_participants
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists participants_conv_select on public.conversation_participants;
create policy participants_conv_select
  on public.conversation_participants
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.conversation_participants mine
      where mine.conversation_id = conversation_participants.conversation_id
        and mine.profile_id = auth.uid()
    )
  );
