-- 1. Soft unfriend: remove friendship, chats auto-delete after 7 days
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

-- 2. Hard delete: unfriend AND delete all messages + conversation instantly
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
    -- Delete all messages in the conversation
    delete from messages where conversation_id = v_conv_id;
    -- Delete conversation participants
    delete from conversation_participants where conversation_id = v_conv_id;
    -- Delete the conversation
    delete from conversations where id = v_conv_id;
  end if;
end;
$$;

-- 3. Block user: optionally unfriend at the same time
create or replace function block_user(p_other_id uuid, p_unfriend boolean default true)
returns void
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_other_id = v_uid then raise exception 'cannot block yourself'; end if;

  -- Insert block (ignore if already exists)
  insert into blocks (blocker_id, blocked_id)
  values (v_uid, p_other_id)
  on conflict do nothing;

  -- Optionally unfriend
  if p_unfriend then
    perform unfriend_user(p_other_id);
  end if;
end;
$$;

-- 4. Cleanup: delete conversations past their retained_until (run via cron or pg_cron)
create or replace function cleanup_retained_chats()
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  -- Delete messages in expired conversations
  delete from messages m
  using conversations c
  where m.conversation_id = c.id
    and c.retained_until is not null
    and c.retained_until < now();

  -- Delete participants
  delete from conversation_participants cp
  using conversations c
  where cp.conversation_id = c.id
    and c.retained_until is not null
    and c.retained_until < now();

  -- Delete the conversations themselves
  delete from conversations
  where retained_until is not null
    and retained_until < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 5. Check if a user is blocked by another user (for chat page)
create or replace function is_blocked(p_me uuid, p_other uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from blocks
    where (blocker_id = p_me and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = p_me)
  );
$$;
