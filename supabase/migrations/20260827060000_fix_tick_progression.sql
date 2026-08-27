-- Fix: trigger_mark_read_on_receipt should NOT set delivered_at.
-- Delivery and read must be separate DB updates so the client receives
-- distinct Realtime UPDATE events for each tick stage:
--   single → double white (delivered_at) → blue (read_at)
-- Previously, both were stamped atomically, causing single → blue jump.
create or replace function public.trigger_mark_read_on_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages m
    set read_at = now()
    where m.conversation_id = new.conversation_id
      and m.sender_id <> new.profile_id
      and m.read_at is null;
  return new;
end;
$$;
