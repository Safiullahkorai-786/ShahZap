-- Add interest-based matching filter to match_preferences.
-- preferred_interests stores interest SLUGS (matching the interests.slug column).
-- In match_next, shared interests boost the score and act as a filter.

alter table public.match_preferences
  add column if not exists preferred_interests text[] not null default '{}';
