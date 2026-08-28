-- Daily translation budget caps. Workers AI on the free plan has a small
-- daily neuron allowance, so we cap how many messages translate per day to
-- stop one heavy user (or a bot) from draining the whole account budget.
--
--   * per-user bucket  : fairness — a single user can't use everything
--   * global bucket    : the real budget guard (can't be bypassed)
--
-- The /api/translate route reserves a slot via translation_reserve() before
-- calling the model, and refunds it (translation_refund) only if the model
-- call fails, so failures never burn the daily budget.

create table if not exists public.translation_usage (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('user','global')),
  key text not null,
  usage_date date not null default current_date,
  count integer not null default 0,
  unique (scope, key, usage_date)
);

alter table public.translation_usage enable row level security;

-- Only the server (service role) writes this; clients never read it. With RLS
-- on and no public policies, the anon/authenticated roles can't touch it.
create policy "service role manages translation usage" on public.translation_usage
  for all to service_role using (true) with check (true);

-- Atomic reserve: bump both counters, then decide if the caps allow the call.
-- If over either cap, refund the increments inside the same transaction so we
-- never overshoot or leak slots.
create or replace function public.translation_reserve(p_user_id text, p_user_cap int, p_global_cap int)
returns json
language plpgsql
security definer
as $$
declare
  u int;
  g int;
  allowed boolean;
begin
  insert into public.translation_usage (scope, key, usage_date, count)
  values ('user', p_user_id, current_date, 1)
  on conflict (scope, key, usage_date)
  do update set count = translation_usage.count + 1
  returning count into u;

  insert into public.translation_usage (scope, key, usage_date, count)
  values ('global', 'global', current_date, 1)
  on conflict (scope, key, usage_date)
  do update set count = translation_usage.count + 1
  returning count into g;

  allowed := (u <= p_user_cap) and (g <= p_global_cap);

  if not allowed then
    update public.translation_usage
       set count = greatest(0, count - 1)
     where scope = 'user' and key = p_user_id and usage_date = current_date;
    update public.translation_usage
       set count = greatest(0, count - 1)
     where scope = 'global' and key = 'global' and usage_date = current_date;
  end if;

  return json_build_object('allowed', allowed, 'user_count', u, 'global_count', g);
end;
$$;

grant execute on function public.translation_reserve(text, int, int) to service_role;

-- Best-effort refund when a model call fails, so the slot isn't wasted.
create or replace function public.translation_refund(p_user_id text)
returns void
language plpgsql
security definer
as $$
begin
  update public.translation_usage
     set count = greatest(0, count - 1)
   where scope = 'user' and key = p_user_id and usage_date = current_date;
  update public.translation_usage
     set count = greatest(0, count - 1)
   where scope = 'global' and key = 'global' and usage_date = current_date;
end;
$$;

grant execute on function public.translation_refund(text) to service_role;
