-- Guarantee conversation_participants UPDATE Realtime events include full rows
-- (last_read_at, typing_at) so blue "seen" ticks + typing flip instantly.
alter table public.conversation_participants replica identity full;
