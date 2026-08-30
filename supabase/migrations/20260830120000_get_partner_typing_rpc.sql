-- get_partner_typing: returns the typing_at timestamp of the other participant
-- in a conversation.  Used by the call chat panel to poll typing state when
-- broadcast events are unavailable (second Supabase channel subscribe is a no-op).
create or replace function public.get_partner_typing(p_conversation_id uuid)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select cp.typing_at
  from public.conversation_participants cp
  where cp.conversation_id = p_conversation_id
    and cp.profile_id <> auth.uid()
  limit 1;
$$;

revoke all on function public.get_partner_typing(uuid) from public, anon;
grant execute on function public.get_partner_typing(uuid) to authenticated;
