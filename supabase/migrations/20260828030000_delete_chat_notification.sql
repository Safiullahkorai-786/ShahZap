-- Add delete_chat to CHECK constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('message', 'friend_request', 'unfriend', 'accept', 'reject', 'blocked', 'unblocked', 'withdraw', 'delete_chat'));

-- Update delete_and_unfriend to create delete_chat notification
CREATE OR REPLACE FUNCTION delete_and_unfriend(p_other_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_other_id = v_uid THEN RAISE EXCEPTION 'cannot delete yourself'; END IF;

  DELETE FROM friend_requests
  WHERE status = 'accepted'
    AND ((sender_id = v_uid AND receiver_id = p_other_id)
      OR (sender_id = p_other_id AND receiver_id = v_uid));

  INSERT INTO notifications (user_id, kind, from_user_id, text)
  VALUES (p_other_id, 'unfriend', v_uid, 'unfriended you');

  INSERT INTO notifications (user_id, kind, from_user_id, text)
  VALUES (p_other_id, 'delete_chat', v_uid, 'deleted your chat');

  SELECT cp.conversation_id INTO v_conv_id
  FROM conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id AND c.status = 'active'
  WHERE cp.profile_id = v_uid
    AND EXISTS (
      SELECT 1 FROM conversation_participants cp2
      WHERE cp2.conversation_id = cp.conversation_id
        AND cp2.profile_id = p_other_id
    )
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    UPDATE messages SET reply_to_message_id = NULL
    WHERE conversation_id = v_conv_id AND reply_to_message_id IS NOT NULL;
    DELETE FROM messages WHERE conversation_id = v_conv_id;
    DELETE FROM conversation_participants WHERE conversation_id = v_conv_id;
    DELETE FROM conversations WHERE id = v_conv_id;
  END IF;
END;
$$;
