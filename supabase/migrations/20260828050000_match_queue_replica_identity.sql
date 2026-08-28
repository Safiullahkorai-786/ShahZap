-- Make match_queue deliver full row data on every Realtime event so the
-- Live badge can update the count INSTANTLY from the event payload instead
-- of round-tripping a count RPC on each change.
--
-- REPLICA IDENTITY FULL sends the complete pre-image for UPDATE/DELETE and
-- the full NEW row for INSERT, letting the client adjust its local count by
-- delta (waiting entries, excluding self) in real time.
alter table public.match_queue replica identity full;
