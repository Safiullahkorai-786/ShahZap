CREATE OR REPLACE FUNCTION block_user(p_other_id uuid, p_unfriend boolean default true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_other_id = v_uid THEN RAISE EXCEPTION 'cannot block yourself'; END IF;

  INSERT INTO blocks (blocker_id, blocked_id)
  VALUES (v_uid, p_other_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO notifications (user_id, kind, from_user_id, text)
  VALUES (p_other_id, 'blocked', v_uid, 'blocked you');

  IF p_unfriend THEN
    -- Soft-fail: don't roll back the block if unfriend fails
    BEGIN
      DELETE FROM friend_requests
      WHERE status = 'accepted'
        AND ((sender_id = v_uid AND receiver_id = p_other_id)
          OR (sender_id = p_other_id AND receiver_id = v_uid));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END;
$$;
