-- Fix read-receipt (and typing) by removing reliance on the possibly-broken
-- private.is_conversation_participant helper inside SECURITY DEFINER RPCs.
--
-- Observed: profiles.last_active_at advances (touch_presence works) but
-- conversation_participants.last_read_at / typing_at never update, even when
-- real participants are actively in the chat. Both mark_conversation_read and
-- set_typing gate on private.is_conversation_participant(conversation_id,
-- auth.uid()); that helper is returning false/erroring for real participants,
-- so those RPCs bail with 'forbidden' and nothing is stamped.

-- mark_conversation_read: check participation with a direct, RLS-bypassed
-- lookup (running as the definer) instead of the helper.
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
  update public.conversation_participants
    set last_read_at = now()
    where conversation_id = p_conversation_id and profile_id = auth.uid();
  -- Deliver + read every inbound message (reads stamps the blue tick).
  update public.messages
    set delivered_at = now(), read_at = now()
    where conversation_id = p_conversation_id
      and sender_id != auth.uid()
      and (delivered_at is null or read_at is null);
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- set_typing: same treatment (typing indicator shares the same gate).
create or replace function public.set_typing(p_conversation_id uuid, p_typing boolean)
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
