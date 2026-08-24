-- Optional interests + interest-priority matching window.
--
-- Product rules (as requested):
--   * Selecting interests during onboarding is OPTIONAL — members who skip
--     are connected instantly with any compatible waiting member;
--   * Members who selected interests get a priority window: while it is
--     active, only candidates sharing at least one interest qualify, and
--     shared-interest pairs are matched immediately;
--   * When the window passes, matching falls back to the normal compatible
--     pool in random order (safe random fallback per product spec);
--   * Default interest wait is now 5 seconds (was 15).

alter table public.match_preferences alter column interest_wait_seconds set default 5;
update public.match_preferences set interest_wait_seconds = 5 where interest_wait_seconds = 15;

-- Engine change inside private.match_next (full body applied to production):
--   new variable  my_window boolean
--     := my queue row still inside expires_at AND I have ≥1 profile_interest;
--   candidate filter gains:
--       and (not my_window or exists(
--             select 1 from public.profile_interests pa
--             join public.profile_interests pb
--               on pb.interest_id = pa.interest_id and pb.profile_id = q.profile_id
--            where pa.profile_id = p_profile_id))
--   ordering CASE now keys off my_window instead of a raw expiry check,
--   so interest-less members always draw from the whole pool instantly;
--   my_window is computed as: member has ≥1 selected interest AND
--   queue row joined < interest_wait_seconds ago (default 5s). It is
--   deliberately DECOUPLED from the queue-row expiry, which is pure
--   liveness and auto-renewed by clients every ~12s while waiting.
--
-- NOTE: the complete function body lives in production; recreate verbatim
-- from the applied definition when rebuilding environments.
