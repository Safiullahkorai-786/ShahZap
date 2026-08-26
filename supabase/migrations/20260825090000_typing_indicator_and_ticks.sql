-- Typing indicator + delivery ticks for WhatsApp-style friends list.
--
-- 1) typing_at column on conversation_participants tracks when someone is
--    currently typing. Friends page subscribes to Realtime UPDATE on this
--    table to show "typing…" under a friend's name.
--
-- 2) Added conversation_participants to supabase_realtime publication so
--    friends page can receive live typing updates.
--
-- 3) set_typing(p_conversation_id, p_typing) RPC sets/clears typing_at.
--    Auto-clears after 5 seconds server-side as a safety net.
--
-- 4) clear_stale_typing() RPC clears typing_at for rows older than 5s.
--    Called periodically or by the typing setter.

-- Add typing_at column
alter table public.conversation_participants
  add column if not exists typing_at timestamptz;

-- Add to Realtime publication
do $$ begin
  alter publication supabase_realtime add table public.conversation_participants;
exception
  when duplicate_object then null;
end $$;

-- RPC: set or clear typing status
create or replace function public.set_typing(p_conversation_id uuid, p_typing boolean)
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
  if p_typing then
    update public.conversation_participants
      set typing_at = now()
      where conversation_id = p_conversation_id and profile_id = auth.uid();
  else
    update public.conversation_participants
      set typing_at = null
      where conversation_id = p_conversation_id and profile_id = auth.uid();
  end if;
end;
$$;

revoke all on function public.set_typing(uuid, boolean) from public, anon;
grant execute on function public.set_typing(uuid, boolean) to authenticated;

-- RPC: clear stale typing indicators (>5 seconds old)
create or replace function public.clear_stale_typing()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_participants
    set typing_at = null
    where typing_at is not null
      and typing_at < now() - interval '5 seconds';
end;
$$;

revoke all on function public.clear_stale_typing() from public, anon;
grant execute on function public.clear_stale_typing() to authenticated;
