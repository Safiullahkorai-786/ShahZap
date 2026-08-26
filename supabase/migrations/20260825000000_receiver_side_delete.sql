-- Receiver-side delete ("Delete for me"):
--   deleted_by_receiver_at timestamptz — receiver hides THEIR copy only.
-- The sender keeps the message; their client shows a small
-- "deleted by receiver" tag next to the timestamp (like "edited").
--
-- Enforcement:
--   * Column-level grant: receivers may ONLY touch this one column.
--   * RLS policy: scoped to messages they received (sender_id <> uid)
--     inside conversations they belong to.

alter table public.messages add column if not exists deleted_by_receiver_at timestamptz;

grant update (deleted_by_receiver_at) on public.messages to authenticated;

drop policy if exists messages_update_received_delete_own_copy on public.messages;
create policy messages_update_received_delete_own_copy
  on public.messages
  for update
  to authenticated
  using (
    sender_id <> auth.uid()
    and private.is_conversation_participant(conversation_id, auth.uid())
  )
  with check (
    sender_id <> auth.uid()
    and private.is_conversation_participant(conversation_id, auth.uid())
  );
