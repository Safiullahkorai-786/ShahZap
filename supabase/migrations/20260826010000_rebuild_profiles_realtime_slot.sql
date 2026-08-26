-- Force Realtime replication rebuild for profiles.
--
-- The REPLICA IDENTITY FULL change in 20260826000000 may not have been
-- picked up by Supabase Realtime's cached logical replication slot.
-- Dropping and re-adding the table forces a full re-sync so UPDATE
-- payloads now carry all columns (last_active_at, online_visible, etc.).

ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
