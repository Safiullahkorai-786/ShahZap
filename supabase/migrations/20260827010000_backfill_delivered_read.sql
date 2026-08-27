-- Backfill delivered_at / read_at for messages sent before this migration.
--
-- Reconstruct the best-known state from existing server data:
--   read_at       → receiver's conversation_participants.last_read_at (if it
--                   covered the message time)
--   delivered_at  → set for every inbound message in any conversation the
--                   receiver has a participant row in (they joined/opened it)

-- read_at from the receiver's last_read_at (both participant rows for a 1:1
-- conversation; read_at applies to messages sent by the OTHER participant).
update public.messages m set read_at = cp.last_read_at
from public.conversation_participants cp
where cp.conversation_id = m.conversation_id
  and cp.profile_id <> m.sender_id
  and cp.last_read_at is not null
  and cp.last_read_at >= m.created_at;

-- delivered_at: any inbound message in a conversation the receiver is part of
-- counts as delivered once they have a participant row.
update public.messages m set delivered_at = now()
from public.conversation_participants cp
where cp.conversation_id = m.conversation_id
  and cp.profile_id <> m.sender_id;
