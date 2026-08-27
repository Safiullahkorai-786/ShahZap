-- Fix: mark_conversation_read should only stamp read_at, not delivered_at.
-- Delivery is handled separately by sync_deliveries / trigger_deliver_on_insert
-- so the client receives distinct Realtime UPDATE events for each tick stage.
-- Previously, this RPC set both in one UPDATE, causing single→blue jump.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not private.is_conversation_participant(p_conversation_id, auth.uid()) then
    raise exception 'forbidden';
  end if;
  update public.conversation_participants
    set last_read_at = now()
    where conversation_id = p_conversation_id and profile_id = auth.uid();
  update public.messages
    set read_at = now()
    where conversation_id = p_conversation_id
      and sender_id != auth.uid()
      and read_at is null;
end;
$$;
