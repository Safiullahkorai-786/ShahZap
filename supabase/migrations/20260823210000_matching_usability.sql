-- Matching usability: make real-world matching actually connect.
--
-- Production evidence: two devices queued one second apart and still never
-- matched. Causes found in live data:
--   1. public.matching_age_compatible(a,b) required EXACT band equality
--      (a = b). A user testing phone (18_20) vs laptop (21_29) could never
--      pair — nor could any two adults from different bands.
--   2. Queue expiry was computed on the CLIENT clock with a 15s window;
--      device clock skew shrank one real attempt to 5 effective seconds.
--   3. No visibility into how many people are looking, so "nothing happened"
--      had no explanation.

-- ── 1. Age compatibility: safety line kept, adults inter-match ──────────────
create or replace function public.matching_age_compatible(a text, b text)
returns boolean
language sql
stable
as $fn$
  -- Minors are NEVER compatible with adults.
  -- Adults (18+) may match across adult bands (exact ages are not collected).
  -- Minors may match only within adjacent minor bands.
  select case
    when a is null or b is null then false
    when a = b then true
    else
      (a in ('under_13','13_15','16_17')) = (b in ('under_13','13_15','16_17'))
      and (
        (a not in ('under_13','13_15','16_17'))
        or abs(
          array_position(array['under_13','13_15','16_17'], a)
          - array_position(array['under_13','13_15','16_17'], b)
        ) <= 1
      )
  end;
$fn$;

-- ── 2. Live queue counter for the matching UI ───────────────────────────────
create or replace function public.match_queue_count()
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  select count(*)::int from public.match_queue q
  where q.status = 'waiting'
    and q.expires_at > now()
    and q.profile_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
$fn$;

revoke all on function public.match_queue_count() from public, anon;
grant execute on function public.match_queue_count() to authenticated;

-- ── 3. Server-authoritative expiry floor (clock-skew protection) ────────────
-- An actively waiting entry can never look already-expired, no matter how far
-- the client's clock drifts. Status transitions to 'expired'/'matched' etc.
-- do not touch expires_at and pass through untouched when status <> 'waiting'.
create or replace function private.match_queue_clamp_expiry()
returns trigger
language plpgsql
as $fn$
begin
  if NEW.status = 'waiting' and NEW.expires_at < now() + interval '10 seconds' then
    NEW.expires_at := now() + interval '30 seconds';
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists match_queue_clamp_expiry on public.match_queue;
create trigger match_queue_clamp_expiry
before insert or update of status, expires_at
on public.match_queue
for each row
execute function private.match_queue_clamp_expiry();
