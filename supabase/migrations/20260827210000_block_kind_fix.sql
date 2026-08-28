CREATE OR REPLACE function block_user(p_other_id uuid, p_unfriend boolean default true)
returns void
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_other_id = v_uid then raise exception 'cannot block yourself'; end if;

  insert into blocks (blocker_id, blocked_id)
  values (v_uid, p_other_id)
  on conflict do nothing;

  insert into notifications (user_id, kind, from_user_id, text)
  values (p_other_id, 'blocked', v_uid, 'blocked you');

  if p_unfriend then
    perform unfriend_user(p_other_id);
  end if;
end;
$$;
