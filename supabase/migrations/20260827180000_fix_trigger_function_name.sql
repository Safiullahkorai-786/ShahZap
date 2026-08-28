-- Fix the ACTUAL trigger function (trigger_notify_on_message, not notify_on_message_insert)
CREATE OR REPLACE FUNCTION trigger_notify_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_receiver uuid;
  v_existing_id uuid;
BEGIN
  SELECT cp.profile_id INTO v_receiver
  FROM conversation_participants cp
  WHERE cp.conversation_id = NEW.conversation_id
    AND cp.profile_id != NEW.sender_id
  LIMIT 1;

  IF v_receiver IS NULL THEN RETURN NEW; END IF;

  -- Check for existing unread message notification from this sender in this conversation
  SELECT id INTO v_existing_id
  FROM notifications
  WHERE user_id = v_receiver
    AND kind = 'message'
    AND from_user_id = NEW.sender_id
    AND conversation_id = NEW.conversation_id
    AND read = false
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE notifications
    SET unread_count = unread_count + 1, created_at = now()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO notifications (user_id, kind, from_user_id, conversation_id, text, unread_count)
    VALUES (v_receiver, 'message', NEW.sender_id, NEW.conversation_id, 'sent you a message', 1);
  END IF;

  RETURN NEW;
END;
$$;
