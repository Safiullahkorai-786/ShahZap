-- Call-log messages for the chat: a single centered system row per call that
-- both participants see (like WhatsApp's "Voice call · 4m 32s").
--
-- We add a message_type column ('text' | 'call') plus structured call metadata
-- so call-log rows can be rendered distinctly and don't need to be treated as
-- ordinary chat text.

alter table public.messages
  add column if not exists message_type text not null default 'text'
    check (message_type in ('text', 'call'));

alter table public.messages
  add column if not exists call_mode text
    check (call_mode is null or call_mode in ('audio', 'video'));

alter table public.messages
  add column if not exists call_status text
    check (call_status is null or call_status in ('answered', 'missed', 'outgoing_unanswered'));

alter table public.messages
  add column if not exists call_duration_seconds integer
    check (call_duration_seconds is null or call_duration_seconds >= 0);

grant select (message_type, call_mode, call_status, call_duration_seconds)
  on public.messages to authenticated;

-- Insert a call-log row. Only the caller invokes this (so exactly ONE row per
-- call is created) and the receiver sees it through normal realtime + select.
-- Runs as security definer so the caller can post the log for the conversation.
create or replace function public.insert_call_log(
  p_conversation_id uuid,
  p_sender_id uuid,
  p_mode text,
  p_status text,
  p_duration_seconds integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  if p_sender_id is null then return; end if;

  -- Only allow logging into a conversation the caller belongs to.
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.profile_id = p_sender_id
  ) then
    return;
  end if;

  v_label := case
    when p_status = 'missed' then 'Missed call'
    when p_status = 'outgoing_unanswered' then 'Call ended'
    when p_mode = 'video' then 'Video call'
    else 'Audio call'
  end;

  insert into public.messages (
    conversation_id,
    sender_id,
    original_message,
    message_type,
    call_mode,
    call_status,
    call_duration_seconds,
    moderation_status
  ) values (
    p_conversation_id,
    p_sender_id,
    v_label,
    'call',
    p_mode,
    p_status,
    coalesce(greatest(p_duration_seconds, 0), 0),
    'allowed'
  );
end;
$$;

grant execute on function public.insert_call_log(uuid, uuid, text, text, integer) to authenticated;

-- Skip creating a 'message' notification for call-log rows (they are not chat
-- text the receiver needs to be pinged about).
create or replace function public.trigger_notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  receiver uuid;
begin
  if coalesce(NEW.message_type, 'text') <> 'text' then
    return NEW;
  end if;

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

-- Don't let the ZapBot auto-reply to call-log rows.
drop trigger if exists messages_bot_autoreply on public.messages;
create trigger messages_bot_autoreply
after insert on public.messages
for each row
when (
  new.sender_id <> all (array['6b275e80-98e2-4e09-96b2-cb50a4a64461'::uuid, '5ec6df08-8aa6-4328-a388-42ec172bdd47'::uuid])
  and coalesce(new.message_type, 'text') = 'text'
)
execute function private.messages_bot_autoreply();
