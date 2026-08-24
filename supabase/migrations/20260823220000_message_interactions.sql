-- WhatsApp-style message interactions: reactions, replies, edit, delete.
--
-- Columns (additive, safe):
--   reactions           jsonb  — { "👍": [profile_id, ...], ... }
--   edited_at           timestamptz — set when the sender edits the text
--   deleted_at          timestamptz — soft-delete tombstone ("message deleted")
--   reply_to_message_id uuid    — swipe-to-reply quote target
--
-- Policy: senders may update their OWN messages (edit text / set edited_at,
-- soft-delete, toggle reactions). Participant check keeps RLS boundaries.

alter table public.messages add column if not exists reactions jsonb not null default '{}'::jsonb;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages(id) on delete set null;

-- Direct updates are sender-scoped: edit text / soft-delete / set edited_at.
revoke update on public.messages from authenticated;
grant update (original_message, edited_at, deleted_at) on public.messages to authenticated;

drop policy if exists messages_update_own on public.messages;
drop policy if exists messages_update_participant on public.messages;
create policy messages_update_own
  on public.messages
  for update
  to authenticated
  using (
    sender_id = auth.uid()
    and private.is_conversation_participant(conversation_id, auth.uid())
  )
  with check (
    sender_id = auth.uid()
    and private.is_conversation_participant(conversation_id, auth.uid())
  );

-- Reactions on ANY participant message go through an atomic RPC (avoids
-- read-modify-write races AND keeps direct UPDATE strictly sender-scoped).
create or replace function private.toggle_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  target public.messages;
  next_reactions jsonb;
  emoji_list jsonb;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if p_emoji is null or length(p_emoji) = 0 or length(p_emoji) > 16 then raise exception 'invalid_emoji'; end if;

  select * into target from public.messages m where m.id = p_message_id;
  if target.id is null then raise exception 'message_not_found'; end if;
  if not private.is_conversation_participant(target.conversation_id, uid) then raise exception 'forbidden'; end if;

  next_reactions := coalesce(target.reactions, '{}'::jsonb);
  emoji_list := coalesce(next_reactions -> p_emoji, '[]'::jsonb);
  if emoji_list ? uid::text then
    emoji_list := emoji_list - uid::text;
  else
    emoji_list := emoji_list || to_jsonb(uid::text);
  end if;
  if jsonb_array_length(emoji_list) = 0 then
    next_reactions := next_reactions - p_emoji;
  else
    next_reactions := jsonb_set(next_reactions, array[p_emoji], emoji_list, true);
  end if;

  update public.messages set reactions = next_reactions where id = p_message_id;
  return next_reactions;
end
$fn$;

create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
begin
  return private.toggle_reaction(p_message_id, p_emoji);
end
$f$;

revoke all on function public.toggle_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

-- Realtime delivery for friend-request lifecycle (chat banner + live menu).
alter publication supabase_realtime add table public.friend_requests;

-- Full old-row payload so Realtime DELETE events carry who unfriended whom.
alter table public.friend_requests replica identity full;
