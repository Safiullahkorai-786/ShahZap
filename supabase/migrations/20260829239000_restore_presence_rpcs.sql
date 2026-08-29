-- Heal migration drift: 20260829120000_active_tab_push.sql was recorded as
-- applied but its DDL never ran on this database — public.user_activity, and
-- the report_activity/report_inactive functions, were all absent. Re-create
-- them idempotently and grant EXECUTE to authenticated only.

create table if not exists public.user_activity (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  active_until timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_activity enable row level security;

drop policy if exists "Users upsert own activity" on public.user_activity;
create policy "Users upsert own activity"
  on public.user_activity for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.report_activity()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.user_activity (user_id, active_until, updated_at)
  values (v_uid, now() + interval '50 seconds', now())
  on conflict (user_id) do update
    set active_until = now() + interval '50 seconds',
        updated_at = now();
end;
$$;

revoke all on function public.report_activity() from public, anon;
grant execute on function public.report_activity() to authenticated;

create or replace function public.report_inactive()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.user_activity (user_id, active_until, updated_at)
  values (v_uid, now(), now())
  on conflict (user_id) do update
    set active_until = now(),
        updated_at = now();
end;
$$;

revoke all on function public.report_inactive() from public, anon;
grant execute on function public.report_inactive() to authenticated;

alter table public.user_activity replica identity full;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
  perform pg_notify('pgrst', 'reload config');
end $$;
