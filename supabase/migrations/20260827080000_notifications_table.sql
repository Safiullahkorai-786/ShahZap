-- Persistent notifications table.
-- Stores all notification events (messages, friend requests, unfriends, etc.)
-- so they survive page refreshes and can be shown with unread counts.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('message', 'friend_request', 'unfriend', 'accept', 'reject')),
  from_user_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  text text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Index for fetching a user's notifications (newest first, unread first)
create index if not exists notifications_user_idx
  on public.notifications(user_id, read, created_at desc);

-- Index for counting unread
create index if not exists notifications_unread_idx
  on public.notifications(user_id, read) where read = false;

-- Enable RLS
alter table public.notifications enable row level security;

-- Users can only see their own notifications
create policy "Users see own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

-- Users can update their own notifications (to mark as read)
create policy "Users update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

-- Service role can insert (via triggers/RPCs)
create policy "Service role inserts notifications"
  on public.notifications for insert
  with check (true);

-- Allow authenticated inserts (for Realtime-triggered inserts via RPC)
create policy "Authenticated insert notifications"
  on public.notifications for insert
  with check (auth.uid() is not null);

-- RPC: mark all notifications as read for a user
create or replace function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  update public.notifications
    set read = true
    where user_id = auth.uid() and read = false;
end;
$$;

revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;

-- RPC: get unread notification count
create or replace function public.unread_notification_count()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.notifications
  where user_id = auth.uid() and read = false;
$$;

revoke all on function public.unread_notification_count() from public, anon;
grant execute on function public.unread_notification_count() to authenticated;

-- RPC: clean up notifications older than 7 days
create or replace function public.cleanup_old_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
  where created_at < now() - interval '7 days';
end;
$$;

revoke all on function public.cleanup_old_notifications() from public, anon;
grant execute on function public.cleanup_old_notifications() to authenticated;

-- Function: insert a notification (called from client after Realtime events)
create or replace function public.push_notification(
  p_user_id uuid,
  p_kind text,
  p_from_user_id uuid,
  p_conversation_id uuid default null,
  p_text text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.notifications (user_id, kind, from_user_id, conversation_id, text)
    values (p_user_id, p_kind, p_from_user_id, p_conversation_id, p_text)
    returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.push_notification(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.push_notification(uuid, text, uuid, uuid, text) to authenticated;

-- Trigger: auto-insert notification on new message (for the receiver)
create or replace function public.trigger_notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  receiver uuid;
begin
  -- Find the other participant in this conversation
  select cp.profile_id into receiver
    from public.conversation_participants cp
    where cp.conversation_id = NEW.conversation_id
      and cp.profile_id <> NEW.sender_id
    limit 1;

  if receiver is not null then
    insert into public.notifications (user_id, kind, from_user_id, conversation_id, text)
      values (receiver, 'message', NEW.sender_id, NEW.conversation_id, '');
  end if;

  return NEW;
end;
$$;

drop trigger if exists notify_on_message_insert on public.messages;
create trigger notify_on_message_insert
  after insert on public.messages
  for each row execute function public.trigger_notify_on_message();

-- Trigger: auto-insert notification on new friend request (for the receiver)
create or replace function public.trigger_notify_on_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.notifications (user_id, kind, from_user_id, text)
      values (NEW.receiver_id, 'friend_request', NEW.sender_id, '');
  elsif TG_OP = 'UPDATE' and NEW.status = 'accepted' and OLD.status = 'pending' then
    -- Notify the sender that their request was accepted
    if NEW.sender_id <> NEW.receiver_id then
      insert into public.notifications (user_id, kind, from_user_id, text)
        values (NEW.sender_id, 'accept', NEW.receiver_id, '');
    end if;
  elsif TG_OP = 'DELETE' then
    -- This is handled by the unfriend logic below
    null;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists notify_on_friend_request on public.friend_requests;
create trigger notify_on_friend_request
  after insert or update on public.friend_requests
  for each row execute function public.trigger_notify_on_friend_request();
