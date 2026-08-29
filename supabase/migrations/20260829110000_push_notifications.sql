-- Web Push (PWA / Chrome) notifications.
--
-- Stores a user's push subscription(s) so notifications can be delivered to
-- their phone even when ShahZap is closed. When a new row is inserted into
-- `notifications`, a pg_net webhook fires the `notify-push` Edge Function
-- which sends the actual push using the Web Push API.
--
-- REQUIRES (do these in the Supabase dashboard / CLI before this works):
--   1. `create extension if not exists pg_net;` and grant usage to the
--      relevant role.
--   2. Create a secret for the webhook (shared with the Edge Function):
--         select vault.create_secret('notify-push-webhook-secret',
--                                     'PUSH_HOOK_SECRET_TOKEN');
--   3. Deploy the `notify-push` Edge Function with secrets:
--         VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
--         PUSH_HOOK_SECRET (must match the token above), and the
--         SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
--      See supabase/functions/notify-push/README.md.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- Users manage their own subscriptions.
create policy "Users read own push subs"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

create policy "Users insert own push subs"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "Users delete own push subs"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

create policy "Users update own push subs"
  on public.push_subscriptions for update
  using (auth.uid() = user_id);

-- Service role / function can read subscriptions to send pushes.
create policy "Service role reads push subs"
  on public.push_subscriptions for select
  using (auth.jwt() ->> 'role' = 'service_role');

-- RPC: save/replace the current user's push subscription (upsert by endpoint).
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        user_id = v_uid,
        updated_at = now();
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- RPC: remove the current user's push subscription by endpoint.
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- RPC: remove every subscription for the current user (used on sign-out).
create or replace function public.clear_push_subscriptions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_subscriptions where user_id = auth.uid();
end;
$$;

revoke all on function public.clear_push_subscriptions() from public, anon;
grant execute on function public.clear_push_subscriptions() to authenticated;

-- ── Deliver pushes when a notification is inserted ────────────────────────
-- Fires an async HTTP request via pg_net to the notify-push Edge Function.
-- Pushes are skipped for bot profiles (noise) and for a user's own actions.
create or replace function public.trigger_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := coalesce(
    current_setting('app.settings.push_function_url', true),
    'https://dgwotipwrfgliusiudux.functions.supabase.co/notify-push'
  );
begin
  -- Ignore most chat-bot / guide notifications (users can't respond to them).
  if NEW.from_user_id in (
    '6b275e80-98e2-4e09-96b2-cb50a4a64461', -- ZapBot
    '5ec6df08-8aa6-4328-a388-42ec172bdd47'  -- ZapGuide
  ) then
    return NEW;
  end if;

  if NEW.kind in ('message', 'friend_request', 'accept', 'reject', 'unfriend', 'blocked', 'delete_chat') then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          current_setting('app.settings.push_hook_secret', true),
          'a2cb5169e128b49e66f8cdce5bed24f2809bde009f56a0aec4cf944472488f64'
        ),
        'Content-Profile', 'notify-push'
      ),
      body := jsonb_build_object(
        'id', NEW.id,
        'user_id', NEW.user_id,
        'kind', NEW.kind,
        'from_user_id', NEW.from_user_id,
        'conversation_id', NEW.conversation_id,
        'text', NEW.text,
        'created_at', NEW.created_at
      )
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists push_on_notification_insert on public.notifications;
create trigger push_on_notification_insert
  after insert on public.notifications
  for each row execute function public.trigger_push_on_notification();
