create table if not exists public.match_queue (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','matched','cancelled','expired')),
  queued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  matched_conversation_id uuid references public.conversations(id) on delete set null,
  unique(profile_id)
);
create index if not exists match_queue_waiting_idx on public.match_queue(status, queued_at) where status='waiting';
create index if not exists match_queue_expiry_idx on public.match_queue(expires_at) where status='waiting';
alter table public.match_queue enable row level security;
drop policy if exists match_queue_own on public.match_queue;
create policy match_queue_own on public.match_queue for all to authenticated using(profile_id=auth.uid()) with check(profile_id=auth.uid());
