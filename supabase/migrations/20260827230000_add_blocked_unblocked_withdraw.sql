-- 1. Drop old constraint, add new kinds
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('message', 'friend_request', 'unfriend', 'accept', 'reject', 'blocked', 'unblocked', 'withdraw'));

-- 2. unblock_user: create notification
CREATE OR REPLACE FUNCTION unblock_user(p_other_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  DELETE FROM blocks WHERE blocker_id = v_uid AND blocked_id = p_other_id;
  INSERT INTO notifications (user_id, kind, from_user_id, text)
  VALUES (p_other_id, 'unblocked', v_uid, 'unblocked you');
END;
$$;

-- 3. withdraw_friend_request: delete the request + notify
CREATE OR REPLACE FUNCTION withdraw_friend_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_receiver uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT receiver_id INTO v_receiver
  FROM friend_requests
  WHERE id = p_request_id AND sender_id = v_uid AND status = 'pending';

  IF v_receiver IS NULL THEN RAISE EXCEPTION 'request not found or not yours'; END IF;

  DELETE FROM friend_requests WHERE id = p_request_id;

  INSERT INTO notifications (user_id, kind, from_user_id, text)
  VALUES (v_receiver, 'withdraw', v_uid, 'cancelled friend request');
END;
$$;
