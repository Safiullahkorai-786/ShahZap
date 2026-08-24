-- New members are visible in the online directory by default.
-- (Existing members keep whatever they chose — no backfill, privacy first.)
alter table public.profiles alter column online_visible set default true;
