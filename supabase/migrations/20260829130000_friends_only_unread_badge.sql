-- Fix the Friends-tab badge so it only counts unread messages from CURRENT
-- friends, not from people you've unfriended/whose chat is retained for the
-- 7-day window (those belong to the Online page instead).
--
-- Before: unread_count_for_user counted EVERY kind='message' notification,
-- including from non-friends, so an ex-friend's messages wrongly bumped the
-- badge on the Friends tab. After: only messages whose sender is still an
-- accepted friend count.
create or replace function public.unread_count_for_user(uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with unread_notifs as (
    select count(*) as n
    from public.notifications n
    where n.user_id = uid
      and n.kind = 'message'
      and n.read = false
      and exists (
        select 1 from public.friend_requests fr
        where fr.status = 'accepted'
          and (
            (fr.sender_id = uid and fr.receiver_id = n.from_user_id)
            or (fr.sender_id = n.from_user_id and fr.receiver_id = uid)
          )
      )
  ),
  pending_requests as (
    select count(*) as n
    from public.friend_requests
    where receiver_id = uid and status = 'pending'
  )
  select (select n from unread_notifs) + (select n from pending_requests);
$$;

revoke all on function public.unread_count_for_user(uuid) from public, anon;
grant execute on function public.unread_count_for_user(uuid) to authenticated;
