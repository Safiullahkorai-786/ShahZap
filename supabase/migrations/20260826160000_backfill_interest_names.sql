update public.profiles p
set interest_names = coalesce((
  select array_agg(i.name order by pi.created_at)
  from public.profile_interests pi
  join public.interests i on i.id = pi.interest_id
  where pi.profile_id = p.id
), '{}')
where p.interest_names = '{}'
  and exists (select 1 from public.profile_interests pi where pi.profile_id = p.id);
