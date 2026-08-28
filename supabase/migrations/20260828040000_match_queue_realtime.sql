-- match_queue must be in supabase_realtime so the Match nav badge can show a
-- LIVE count of how many people are currently looking for a match. Any wait
-- (INSERT/UPDATE/DELETE) triggers a re-query of match_queue_count().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'match_queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_queue;
  END IF;
END
$$;
