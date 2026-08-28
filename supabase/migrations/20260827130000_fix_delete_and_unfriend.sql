create or replace function delete_and_unfriend(p_other_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_conv_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_other_id = v_uid then raise exception 'cannot delete yourself'; end if;

  -- Remove the friend request
  delete from friend_requests
  where status = 'accepted'
    and ((sender_id = v_uid and receiver_id = p_other_id)
      or (sender_id = p_other_id and receiver_id = v_uid));

  -- Find the DM conversation
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
    -- Nullify reply references first (self-referencing FK)
    update messages set reply_to_message_id = NULL
    where conversation_id = v_conv_id AND reply_to_message_id IS NOT NULL;
    -- Delete all messages
    delete from messages where conversation_id = v_conv_id;
    -- Delete participants
    delete from conversation_participants where conversation_id = v_conv_id;
    -- Delete conversation
    delete from conversations where id = v_conv_id;
  end if;
end;
$$;
