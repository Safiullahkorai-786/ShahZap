-- Returns count of (unread messages from friends) + (pending friend requests)
create or replace function unread_count_for_user(uid uuid)
returns integer
language sql
stable
as $$
  with friends as (
    select case when sender_id = uid then receiver_id else sender_id end as friend_id
    from friend_requests
    where status = 'accepted'
      and (sender_id = uid or receiver_id = uid)
  ),
  unread_from_friends as (
    select count(*) as n
    from messages m
    join friends f on f.friend_id = m.sender_id
    where m.sender_id != uid
      and m.read_at is null
  ),
  pending_requests as (
    select count(*) as n
    from friend_requests
    where receiver_id = uid
      and status = 'pending'
  )
  select (select n from unread_from_friends) + (select n from pending_requests);
$$;
