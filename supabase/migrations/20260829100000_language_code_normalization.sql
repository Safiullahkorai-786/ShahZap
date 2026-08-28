-- Normalize language codes to the supported 20-code set, so matching (which
-- compares chat_language / preferred_languages by exact code equality) keeps
-- pairing smoothly after the app switched its language pickers.
--
-- Only the unambiguous legacy shorthand is remapped here: "zh" -> "zh_cn"
-- (Chinese Simplified). The deprecated codes (fa/ms/it, already dropped from
-- the pickers) are intentionally not force-mapped because there is no clean
-- replacement target — they are simply no longer selectable going forward.

update public.profiles
set chat_language = 'zh_cn'
where chat_language = 'zh';

update public.profiles
set interface_language = 'zh_cn'
where interface_language = 'zh';

update public.match_preferences
set preferred_languages = (
  select array_agg(case when x = 'zh' then 'zh_cn' else x end order by ord)
  from unnest(preferred_languages) with ordinality as t(x, ord)
)
where 'zh' = any(preferred_languages);
