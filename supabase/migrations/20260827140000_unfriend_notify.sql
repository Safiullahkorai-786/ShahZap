create or replace function unfriend_user(p_other_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_conv_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_other_id = v_uid then raise exception 'cannot unfriend yourself'; end if;

  -- Remove the friend request (either direction)
  delete from friend_requests
  where status = 'accepted'
    and ((sender_id = v_uid and receiver_id = p_other_id)
      or (sender_id = p_other_id and receiver_id = v_uid));

  -- Notify the other person
  insert into notifications (user_id, kind, from_user_id, text)
  values (p_other_id, 'unfriend', v_uid, 'unfriended you');

  -- Find the DM conversation between us and set retained_until for 7 days
  select cp.conversation_id into v_conv_id
  from conversation_participants cp
  join conversations c on c.id = cp.conversation_id and c.status = 'active'
  where cp.profile_id = v_uid
    and exists (
      select 1 from conversation_participants cp2
      where cp2.conversation_id = cp.conversation_id
        and cp2.profile_id = p_other_id
    )
  limit 1;

  if v_conv_id is not null then
    update conversations
    set retained_until = now() + interval '7 days'
    where id = v_conv_id and retained_until is null;
  end if;
end;
$$;
