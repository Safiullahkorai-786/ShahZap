-- 1. Add unread_count column for grouped message notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 1;

-- 2. Replace message notification trigger to group by conversation+sender
CREATE OR REPLACE FUNCTION notify_on_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_receiver uuid;
  v_existing_id uuid;
BEGIN
  -- Determine the receiver (the other person in the conversation)
  SELECT cp.profile_id INTO v_receiver
  FROM conversation_participants cp
  WHERE cp.conversation_id = NEW.conversation_id
    AND cp.profile_id != NEW.sender_id
  LIMIT 1;

  IF v_receiver IS NULL THEN RETURN NEW; END IF;

  -- Check if there's already an unread message notification from this sender in this conversation
  SELECT id INTO v_existing_id
  FROM notifications
  WHERE user_id = v_receiver
    AND kind = 'message'
    AND from_user_id = NEW.sender_id
    AND conversation_id = NEW.conversation_id
    AND read = false
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Increment the count on the existing notification
    UPDATE notifications
    SET unread_count = unread_count + 1,
        created_at = now()
    WHERE id = v_existing_id;
  ELSE
    -- Create a new grouped notification
    INSERT INTO notifications (user_id, kind, from_user_id, conversation_id, text, unread_count)
    VALUES (v_receiver, 'message', NEW.sender_id, NEW.conversation_id, 'sent you a message', 1);
  END IF;

  RETURN NEW;
END;
$$;

-- 3. RPC to mark message notifications as read when DM is opened
CREATE OR REPLACE FUNCTION mark_message_notifications_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE notifications
  SET read = true, unread_count = 0
  WHERE user_id = auth.uid()
    AND kind = 'message'
    AND conversation_id = p_conversation_id
    AND read = false;
END;
$$;

-- 4. Update unread_count_for_user to count distinct conversations with unread message notifications
-- (not individual messages)
CREATE OR REPLACE FUNCTION unread_count_for_user(uid uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH unread_notifs AS (
    SELECT count(*) AS n
    FROM notifications
    WHERE user_id = uid
      AND kind = 'message'
      AND read = false
  ),
  pending_requests AS (
    SELECT count(*) AS n
    FROM friend_requests
    WHERE receiver_id = uid
      AND status = 'pending'
  )
  SELECT (SELECT n FROM unread_notifs) + (SELECT n FROM pending_requests);
$$;
