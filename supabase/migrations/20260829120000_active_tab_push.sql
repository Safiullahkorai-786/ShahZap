-- Active-tab presence for Web Push suppression.
--
-- Tells the push trigger whether the recipient is currently, actively on the
-- ShahZap app tab. When they are, in-app banner + sound handle the
-- notification, so a native OS push would be redundant — the trigger skips it.
-- When the user leaves the tab / minimizes / closes the PWA, presence goes
-- inactive (immediately on hide, or within ~50s via heartbeat expiry) and
-- native OS pushes resume.
--
-- Client: the existing PresenceHeartbeat component now calls report_activity()
-- while the tab is visible and report_inactive() the moment it goes hidden.

create table if not exists public.user_activity (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  active_until timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_activity enable row level security;

-- A user manages their own activity row (the heartbeat upserts it).
create policy "Users upsert own activity"
  on public.user_activity for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The push trigger runs with the table owner's rights, so it can read any row.

-- RPC: mark the current user as actively on the tab for the next 50s.
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

-- RPC: mark the current user as away immediately (tab hidden/left).
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

-- ── Presence-aware push trigger ─────────────────────────────────────────
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

  -- If the recipient is currently ON the app tab, their in-app banner/sound
  -- already notify them — don't also send a native OS push here.
  if exists (
    select 1 from public.user_activity
    where user_id = NEW.user_id and active_until > now()
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
