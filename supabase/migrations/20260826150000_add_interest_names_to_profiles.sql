alter table public.profiles add column if not exists interest_names text[] not null default '{}';
