-- Phase 4.3: A DM must be openable with a recipient regardless of whether the
-- recipient is currently online/present. Presence/WebRTC are transport
-- concerns, not conversation-existence concerns.
--
-- The previous visibility guard only allowed a direct chat if the target
-- opted into the online/visible directory (profile_visible OR online_visible).
-- An accepted FRIEND who is fully private AND offline would therefore be
-- unreachable: opening their DM failed. Friendship is explicit mutual consent
-- to communicate 1-on-1, so it must also authorize a direct chat even when the
-- peer is offline and keeps both directory flags off.
--
-- This preserves the existing consent model (directory opt-in still allows
-- strangers to DM), while making accepted friends always DM-able.

create or replace function public.start_direct_chat(p_other_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  other uuid := p_other_profile_id;
  existing uuid;
begin
  if me is null then
    raise exception 'Authentication required.';
  end if;

  if other is null or other = me then
    raise exception 'Invalid chat target.';
  end if;

  -- The recipient must be reachable 1-on-1. Reachability is satisfied by
  -- EITHER directory consent (visible/online opt-in) OR an accepted
  -- friendship. Friendship is independent of presence and directory flags, so
  -- an offline, fully-private friend remains DM-able.
  if not exists (
    select 1 from public.profiles p
    where p.id = other
      and (
        p.profile_visible = true
        or p.online_visible = true
        or exists (
          select 1 from public.friend_requests fr
          where fr.status = 'accepted'
            and (
              (fr.sender_id = me and fr.receiver_id = other)
              or (fr.sender_id = other and fr.receiver_id = me)
            )
        )
      )
  ) then
    raise exception 'That member is not available for direct chat.';
  end if;

  if exists (
    select 1 from public.blocks
    where (blocker_id = me and blocked_id = other)
       or (blocker_id = other and blocked_id = me)
  ) then
    raise exception 'You cannot start a chat with this member.';
  end if;

  select c.id into existing
  from public.conversations c
  join public.conversation_participants mine on mine.conversation_id = c.id and mine.profile_id = me
  join public.conversation_participants theirs on theirs.conversation_id = c.id and theirs.profile_id = other
  where c.status = 'active'
    and (select count(*) from public.conversation_participants cp where cp.conversation_id = c.id) = 2
  order by c.created_at desc
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.conversations(status) values ('active') returning id into existing;
  insert into public.conversation_participants(conversation_id, profile_id)
    values (existing, me), (existing, other);

  return existing;
end;
$$;

revoke all on function public.start_direct_chat(uuid) from anon, public;
grant execute on function public.start_direct_chat(uuid) to authenticated;
