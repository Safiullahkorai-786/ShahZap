alter table public.profiles add column if not exists languages_known text[] not null default '{}';
