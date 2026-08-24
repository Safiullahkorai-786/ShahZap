-- Fix RPC security context so authenticated users can reach chat.
--
-- Context: the production database isolates privileged implementations in a
-- `private` schema. Public wrapper functions delegate to them
-- (`begin return private.<impl>(...); end;`) with every authorization check
-- living inside the private impls (auth.uid() / is_staff()).
--
-- Two misconfigurations made conversations impossible for real users:
--   1. The public wrappers were left SECURITY INVOKER while calling objects
--      in `private`, which authenticated has no USAGE on → every call failed
--      with "permission denied for schema private" (HTTP 403). Matching
--      (match_next) therefore never created a conversation, so /chat/<id>
--      was unreachable. Same breakage hit redeem_reward, activate_chat_pass,
--      gamification_apply_event and admin_record_action.
--   2. RLS policies on conversations / conversation_participants / messages /
--      admin_audit_log / moderation_actions call private helpers
--      (is_conversation_participant, is_staff), but those helpers had no
--      EXECUTE grant for `authenticated`. RLS expressions run under the
--      caller's privileges, so even reading messages failed with
--      "permission denied for function is_conversation_participant".
--
-- Fix mirrors the already-working pattern used by public.start_direct_chat
-- (SECURITY DEFINER wrapper + explicit grants):
--   - wrappers become SECURITY DEFINER (they only forward arguments;
--     all authorization stays inside the private impls);
--   - EXECUTE on wrappers revoked from PUBLIC/anon, kept for authenticated;
--   - EXECUTE granted to authenticated for the two private helpers that
--     RLS policies invoke.

-- ── 1. Wrappers: invoker → definer ───────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'match_next' and not p.prosecdef) then
    alter function public.match_next(uuid) security definer;
    revoke all on function public.match_next(uuid) from public, anon;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'redeem_reward' and not p.prosecdef) then
    alter function public.redeem_reward(text) security definer;
    revoke all on function public.redeem_reward(text) from public, anon;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'activate_chat_pass' and not p.prosecdef) then
    alter function public.activate_chat_pass(uuid) security definer;
    revoke all on function public.activate_chat_pass(uuid) from public, anon;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'gamification_apply_event' and not p.prosecdef) then
    alter function public.gamification_apply_event(uuid, text, integer, integer, text, jsonb) security definer;
    revoke all on function public.gamification_apply_event(uuid, text, integer, integer, text, jsonb) from public, anon;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'admin_record_action' and not p.prosecdef) then
    alter function public.admin_record_action(text, text, uuid, jsonb) security definer;
    revoke all on function public.admin_record_action(text, text, uuid, jsonb) from public, anon;
  end if;
end $$;

-- ── 2. Private helpers invoked by RLS policies ───────────────────────────────

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.proname = 'is_conversation_participant') then
    grant execute on function private.is_conversation_participant(uuid, uuid) to authenticated;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.proname = 'is_staff') then
    grant execute on function private.is_staff() to authenticated;
  end if;
end $$;
