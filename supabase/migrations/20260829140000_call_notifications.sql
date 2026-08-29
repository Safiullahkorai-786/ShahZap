-- Extend notifications.kind to include incoming call invites.
alter table public.notifications
  drop constraint if exists notifications_kind_check,
  add constraint notifications_kind_check check (
    kind in ('message', 'friend_request', 'unfriend', 'accept', 'reject',
             'blocked', 'unblocked', 'withdraw', 'delete_chat', 'call')
  );

-- Insert an incoming-call invite notification for the callee, replacing any
-- stale invite from the same caller on the same conversation (so only the
-- most recent call shows in the bell / push).
create or replace function public.create_call_notification(p_conversation_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_callee uuid;
begin
  if v_caller is null then return; end if;

  select profile_id into v_callee
  from public.conversation_participants
  where conversation_id = p_conversation_id
    and profile_id <> v_caller
  order by joined_at asc
  limit 1;

  if v_callee is null then return; end if;

  delete from public.notifications
    where user_id = v_callee
      and kind = 'call'
      and from_user_id = v_caller
      and conversation_id = p_conversation_id;

  insert into public.notifications (user_id, kind, from_user_id, conversation_id, text)
    values (v_callee, 'call', v_caller, p_conversation_id, p_mode);
end;
$$;

-- Mark pending call invites for a conversation as resolved (accepted, declined
-- or timed out) so they don't linger in the bell.
create or replace function public.resolve_call_notification(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
    where user_id = auth.uid()
      and kind = 'call'
      and conversation_id = p_conversation_id;
end;
$$;

grant execute on function public.create_call_notification(uuid, text) to authenticated;
grant execute on function public.resolve_call_notification(uuid) to authenticated;

-- Include call invites in the native OS push path (skips when the recipient is
-- actively on the app tab; the in-app call overlay handles that case instead).
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
  if NEW.from_user_id in (
    '6b275e80-98e2-4e09-96b2-cb50a4a64461', -- ZapBot
    '5ec6df08-8aa6-4328-a388-42ec172bdd47'  -- ZapGuide
  ) then
    return NEW;
  end if;

  if exists (
    select 1 from public.user_activity
    where user_id = NEW.user_id and active_until > now()
  ) then
    return NEW;
  end if;

  if NEW.kind in ('message', 'friend_request', 'accept', 'reject', 'unfriend', 'blocked', 'delete_chat', 'call') then
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
