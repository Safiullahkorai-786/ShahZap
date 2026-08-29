-- Restore base-table grants on public.messages for PostgREST.
-- Symptom: POST /rest/v1/messages returned 404 while SELECT still worked —
-- the authenticated role's base INSERT grant on messages was missing, so
-- PostgREST hid the writable relation. RLS policies remain the row-level
-- gatekeeper (sender_id = auth.uid() + participant check).
--
-- NOTE: `update` is deliberately NOT granted broadly here; it is already
-- column-scoped (original_message, edited_at, deleted_at) by
-- 20260823220000_message_interactions.sql so we must not override that.

grant select on public.messages to anon, authenticated;
grant insert, delete on public.messages to authenticated;
