-- WhatsApp-style ticks: single (sent), double-white (delivered/online), blue (read).
--
-- Delivered = other person is currently online (real-time, regresses).
-- Read = other person opened the chat (permanent, blue tick).
--
-- mark_conversation_read:
--   1. Updates participants.last_read_at (triggers the read_at trigger on messages).
--   2. Directly stamps read_at on inbound messages as a safety net.
--   3. Also stamps delivered_at on inbound messages (so the sender sees at least
--      a double tick even if Realtime is flaky — the client overrides delivered
--      state with real-time presence anyway).

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not exists (
    select 1 from public.conversation_participants pc
    where pc.conversation_id = p_conversation_id
      and pc.profile_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;
  -- 1. Update read receipt on the participant row (fires the trigger).
  update public.conversation_participants
    set last_read_at = now()
    where conversation_id = p_conversation_id and profile_id = auth.uid();
  -- 2. Directly stamp read_at + delivered_at on inbound messages.
  --    The trigger also does this, but the direct UPDATE ensures Realtime
  --    fires even if the trigger has a timing issue.
  update public.messages
    set read_at = now(),
        delivered_at = coalesce(delivered_at, now())
    where conversation_id = p_conversation_id
      and sender_id != auth.uid()
      and read_at is null;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- sync_deliveries: mark inbound messages as delivered for all conversations
-- the user participates in. Called by the presence heartbeat.
create or replace function public.sync_deliveries()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  update public.messages m
    set delivered_at = now()
    from public.conversation_participants cp
    where cp.profile_id = auth.uid()
      and cp.conversation_id = m.conversation_id
      and m.sender_id != auth.uid()
      and m.delivered_at is null;
end;
$$;

revoke all on function public.sync_deliveries() from public, anon;
grant execute on function public.sync_deliveries() to authenticated;

-- Trigger: stamp read_at when last_read_at is updated on conversation_participants.
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

-- Trigger: stamp delivered on insert if peer is currently online.
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

-- Trigger: deliver inbound messages when presence updates.
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
