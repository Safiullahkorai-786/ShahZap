-- Friend-request rejection limit.
--
-- Once a member has DECLINED 3 requests from the same sender, that sender
-- can never send them another request. Enforced at the database level with
-- a BEFORE INSERT/UPDATE trigger so it holds no matter which code path
-- creates or revives a pending row. Declined rows are permanent history
-- (status enum keeps 'declined'), so counting them is reliable.
--
-- The raised message is user-facing (friendlyError passes P0001 text
-- straight to the UI).

create or replace function public.enforce_request_rejection_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  declined int;
begin
  -- Only police transitions INTO 'pending' (new request or revived one).
  if tg_op = 'UPDATE' and old.status is not distinct from 'pending' then
    return new;
  end if;
  if new.status <> 'pending' then
    return new;
  end if;

  select count(*) into declined
  from public.friend_requests fr
  where fr.sender_id = new.sender_id
    and fr.receiver_id = new.receiver_id
    and fr.status = 'declined';

  if declined >= 3 then
    raise exception 'Requests disabled — they have declined your friend request 3 times.';
  end if;

  return new;
end;
$$;

drop trigger if exists friend_requests_rejection_limit on public.friend_requests;
create trigger friend_requests_rejection_limit
  before insert or update of status on public.friend_requests
  for each row
  execute function public.enforce_request_rejection_limit();
