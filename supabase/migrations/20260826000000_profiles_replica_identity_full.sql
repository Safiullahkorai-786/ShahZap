-- Critical fix: REPLICA IDENTITY FULL on profiles
--
-- Without this, Realtime UPDATE events only carry the primary key (id).
-- The payload.new has no last_active_at, no online_visible — so the
-- heartbeat updates are invisible to all subscribers.  Every chat's
-- online dot and the Online page's realtime list were dead on arrival.

ALTER TABLE public.profiles REPLICA IDENTITY FULL;
