create or replace function unblock_user(p_other_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_other_id;
end;
$$;
