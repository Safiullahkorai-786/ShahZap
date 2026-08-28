CREATE OR REPLACE FUNCTION cancel_friend_request(p_receiver uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  uid uuid := auth.uid();
  n int;
  v_request_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  -- Get the request id before deleting (for notification)
  SELECT id INTO v_request_id
  FROM friend_requests
  WHERE sender_id = uid AND receiver_id = p_receiver AND status = 'pending';

  DELETE FROM friend_requests
  WHERE sender_id = uid AND receiver_id = p_receiver AND status = 'pending';

  GET DIAGNOSTICS n = ROW_COUNT;

  IF n > 0 AND v_request_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, kind, from_user_id, text)
    VALUES (p_receiver, 'withdraw', uid, 'cancelled friend request');
  END IF;

  RETURN jsonb_build_object('status', CASE WHEN n > 0 THEN 'cancelled' ELSE 'nothing' END);
END;
$$;
