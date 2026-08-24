-- Direct chats from the online directory: clients cannot create conversations
-- under RLS (no insert policy on conversations), so expose a guarded RPC that
-- finds or creates a 1:1 conversation between the caller and another member.

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

  if not exists (
    select 1 from public.profiles where id = other and profile_visible = true
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
