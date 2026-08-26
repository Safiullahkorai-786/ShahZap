alter table public.profiles add column if not exists region_visible boolean not null default false;
alter table public.profiles add column if not exists languages_known_visible boolean not null default false;
