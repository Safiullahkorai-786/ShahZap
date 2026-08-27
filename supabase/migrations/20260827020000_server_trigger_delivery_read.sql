-- Server-authoritative delivery + read stamps via triggers.
--
-- Delivery/read must work even for clients running older cached bundles, so
-- we stamp messages server-side on authoritative signals that already fire no
-- matter the client version:
--
--   * profiles.last_active_at      ← presence heartbeat (always fires while a
--                                     user is online) ⇒ deliver inbound msgs
--   * conversation_participants.last_read_at ← mark_conversation_read (fires
--                                     when the reader opens the DM) ⇒ read
--   * messages INSERT              ← stamp delivered immediately if the peer
--                                     is currently online

-- 1) Deliver inbound messages for a user whenever their presence updates.
create or replace function public.trigger_deliver_on_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages m
    set delivered_at = now()
    from public.conversation_participants cp
    where cp.conversation_id = m.conversation_id
      and cp.profile_id = new.id
      and m.sender_id <> new.id
      and m.delivered_at is null;
  return new;
end;
$$;

drop trigger if exists profiles_deliver_after_update on public.profiles;
create trigger profiles_deliver_after_update
  after update of last_active_at on public.profiles
  for each row execute function public.trigger_deliver_on_presence();

-- 2) Stamp read (+delivered) on inbound messages when the reader open/updates
--    the conversation read receipt (mark_conversation_read ran).
create or replace function public.trigger_mark_read_on_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages m
    set read_at = now(),
        delivered_at = coalesce(m.delivered_at, now())
    where m.conversation_id = new.conversation_id
      and m.sender_id <> new.profile_id
      and m.read_at is null;
  return new;
end;
$$;

drop trigger if exists participants_mark_read_after_update on public.conversation_participants;
create trigger participants_mark_read_after_update
  after update of last_read_at on public.conversation_participants
  for each row execute function public.trigger_mark_read_on_receipt();

-- 3) Stamp delivered immediately on insert if the peer is online right now.
create or replace function public.trigger_deliver_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  peer uuid;
begin
  select cp.profile_id into peer
    from public.conversation_participants cp
    where cp.conversation_id = new.conversation_id
      and cp.profile_id <> new.sender_id
      and exists (
        select 1 from public.profiles p
        where p.id = cp.profile_id
          and p.last_active_at > now() - interval '20 seconds'
      )
    limit 1;
  if peer is not null then
    new.delivered_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_deliver_before_insert on public.messages;
create trigger messages_deliver_before_insert
  before insert on public.messages
  for each row execute function public.trigger_deliver_on_insert();
