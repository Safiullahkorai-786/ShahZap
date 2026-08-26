-- Bulletproof presence + read receipts (server-authoritative).
--
-- Why: heartbeats previously wrote last_active_at from the CLIENT clock
-- via direct table UPDATEs. Device clock skew breaks the 60s online
-- window ("online in my phone, offline on theirs"), and any silent
-- RLS/trigger failure left presence permanently stale.
--
-- Fix: SECURITY DEFINER RPCs stamping DATABASE now() — no skew possible,
-- no grant/policy path can silently drop the write.
--
--   touch_presence()            → profiles.last_active_at = now()
--   mark_conversation_read(id)  → participants.last_read_at = now()
--                                 (participant check via private helper)

create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_active_at = now() where id = auth.uid();
$$;

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
end;
$$;

revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
