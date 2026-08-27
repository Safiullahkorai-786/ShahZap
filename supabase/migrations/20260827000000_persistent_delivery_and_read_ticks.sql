-- Persistent delivery + read ticks (WhatsApp-style, never regress).
--
-- Problem: delivery/read were derived from ephemeral presence
-- (profiles.last_active_at / conversation_participants.last_read_at), so a
-- delivered double tick flipped back to a single tick the moment the
-- partner went offline, and blue "seen" depended on a flaky interval that
-- some mobile/PWA shells skipped.
--
-- Fix: stash per-message server state directly on messages:
--   delivered_at  → the receiver's account received it (online)
--   read_at       → the receiver opened the conversation and read it
-- Ticks read these columns, so they are stable and can only move forward.
--
--   single tick  = delivered_at IS NULL
--   double tick  = delivered_at set, read_at NULL
--   blue tick    = read_at set

alter table public.messages
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;

create index if not exists messages_delivery_idx
  on public.messages(conversation_id, read_at, delivered_at);

-- Ensure Realtime UPDATE events carry delivered_at/read_at to the sender so
-- the tick flips live (not just on the next poll).
alter table public.messages replica identity full;

-- mark_conversation_read now ALSO stamps delivered + read on every inbound
-- message (sender_id != the acting receiver). Opening the chat = delivered
-- and read, just like WhatsApp.
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
    set delivered_at = now(), read_at = now()
    where conversation_id = p_conversation_id
      and sender_id != auth.uid()
      and (delivered_at is null or read_at is null);
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- sync_deliveries: mark all inbound messages across the acting user's
-- conversations as delivered (online but not necessarily in the chat).
-- Called alongside the presence heartbeat so delivery happens even when the
-- receiver never opens the DM.
create or replace function public.sync_deliveries()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  for r in
    select pc.conversation_id
    from public.conversation_participants pc
    where pc.profile_id = auth.uid()
  loop
    update public.messages
      set delivered_at = now()
      where conversation_id = r.conversation_id
        and sender_id != auth.uid()
        and delivered_at is null;
  end loop;
end;
$$;

revoke all on function public.sync_deliveries() from public, anon;
grant execute on function public.sync_deliveries() to authenticated;
