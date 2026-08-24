-- Profile/Settings split + language-filter matching.
--
-- * /profile  = identity editor (name, age band, gender, orientation,
--   generation, interface/chat language, interests)
-- * /settings = privacy toggles + who-to-meet preferences + appearance
--
-- New opt-in column: match_preferences.language_filter_enabled.
-- When true, the matcher only pairs members whose chat_language is one of
-- my known languages (preferred_languages). When false (default), those
-- languages are informational and never restrict matching.

alter table public.match_preferences
  add column if not exists language_filter_enabled boolean not null default false;
