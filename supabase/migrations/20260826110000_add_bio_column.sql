alter table public.profiles add column if not exists bio text check (bio is null or length(bio) <= 150);
