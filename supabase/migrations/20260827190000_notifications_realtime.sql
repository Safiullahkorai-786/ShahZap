-- notifications table must be in supabase_realtime for Realtime subscriptions to work
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
