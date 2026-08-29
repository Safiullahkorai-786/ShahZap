-- Correect the previous migration's security over-grant.
-- 20260829230000_restore_api_grants.sql (first push) granted EXECUTE on all
-- public functions to BOTH anon and authenticated, unintentionally undoing this
-- project's deliberate `revoke all on function ... from public, anon` on
-- security-sensitive RPCs. Restore the intended posture: anon has no EXECUTE
-- on public functions.

revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke execute on functions from anon;
