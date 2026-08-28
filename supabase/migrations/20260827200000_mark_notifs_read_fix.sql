CREATE OR REPLACE FUNCTION mark_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE notifications
  SET read = true, unread_count = 0
  WHERE user_id = auth.uid() AND read = false;
END;
$$;
