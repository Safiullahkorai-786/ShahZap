-- Updated match_next with continent filter support.
-- Continents expand to ISO country codes via continent_countries().

create or replace function public.match_next(p_profile_id uuid)
returns table(conversation_id uuid, matched_profile_id uuid)
language plpgsql security definer set search_path = public
as $$
declare me record; my_prefs record; candidate_id uuid; candidate_expires timestamptz; new_conversation uuid;
begin
  if auth.uid() is null or auth.uid() <> p_profile_id then raise exception 'unauthorized'; end if;
  select p.* into me from public.profiles p where p.id=p_profile_id for update;
  if me.id is null then raise exception 'profile_not_found'; end if;
  select mp.* into my_prefs from public.match_preferences mp where mp.profile_id=p_profile_id;
  if not exists(select 1 from public.match_queue where profile_id=p_profile_id and status='waiting') then return; end if;
  update public.match_queue set status='expired' where status='waiting' and expires_at <= now() and profile_id <> p_profile_id;
  for candidate_id, candidate_expires in
    select q.profile_id,q.expires_at
    from public.match_queue q join public.profiles cp on cp.id=q.profile_id
    where q.status='waiting' and q.profile_id<>p_profile_id and cp.profile_visible=true
      and public.matching_age_compatible(me.age_band,cp.age_band)
      and not exists(select 1 from public.blocks b where (b.blocker_id=p_profile_id and b.blocked_id=q.profile_id) or (b.blocker_id=q.profile_id and b.blocked_id=p_profile_id))
      and (coalesce(cardinality(my_prefs.preferred_age_bands),0)=0 or cp.age_band=any(my_prefs.preferred_age_bands))
      and (coalesce(cardinality(my_prefs.preferred_genders),0)=0 or cp.gender=any(my_prefs.preferred_genders))
      and (coalesce(cardinality(my_prefs.preferred_orientations),0)=0 or cp.orientation=any(my_prefs.preferred_orientations))
      and (coalesce(cardinality(my_prefs.preferred_generations),0)=0 or cp.generation=any(my_prefs.preferred_generations))
      and (coalesce(cardinality(my_prefs.preferred_languages),0)=0 or cp.chat_language=any(my_prefs.preferred_languages))
      and (not coalesce(my_prefs.country_targeting_enabled,false) or coalesce(cardinality(my_prefs.preferred_countries),0)=0 or cp.country_code=any(my_prefs.preferred_countries))
      and (coalesce(cardinality(my_prefs.preferred_continents),0)=0 or cp.country_code in (select public.continent_countries(unnest(my_prefs.preferred_continents))))
      and not exists(select 1 from public.match_preferences op where op.profile_id=q.profile_id and cardinality(op.preferred_age_bands)>0 and coalesce(me.age_band,'')<>all(op.preferred_age_bands))
      and not exists(select 1 from public.match_preferences op where op.profile_id=q.profile_id and cardinality(op.preferred_genders)>0 and coalesce(me.gender,'')<>all(op.preferred_genders))
      and not exists(select 1 from public.match_preferences op where op.profile_id=q.profile_id and cardinality(op.preferred_orientations)>0 and coalesce(me.orientation,'')<>all(op.preferred_orientations))
      and not exists(select 1 from public.match_preferences op where op.profile_id=q.profile_id and cardinality(op.preferred_generations)>0 and coalesce(me.generation,'')<>all(op.preferred_generations))
      and not exists(select 1 from public.match_preferences op where op.profile_id=q.profile_id and cardinality(op.preferred_languages)>0 and coalesce(me.chat_language,'')<>all(op.preferred_languages))
      and not exists(select 1 from public.match_preferences op where op.profile_id=q.profile_id and op.country_targeting_enabled and cardinality(op.preferred_countries)>0 and coalesce(me.country_code,'')<>all(op.preferred_countries))
      and not exists(select 1 from public.match_preferences op where op.profile_id=q.profile_id and cardinality(op.preferred_continents)>0 and me.country_code not in (select public.continent_countries(unnest(op.preferred_continents))))
    order by case when exists(select 1 from public.match_queue mq where mq.profile_id=p_profile_id and mq.status='waiting' and mq.expires_at>now()) then public.matching_score(p_profile_id,q.profile_id) else floor(random()*100000)::integer end desc,q.queued_at asc
    limit 20
  loop
    update public.match_queue set status='matched' where profile_id=candidate_id and status='waiting' returning expires_at into candidate_expires;
    if found then
      update public.match_queue set status='matched' where profile_id=p_profile_id and status='waiting';
      if not found then return; end if;
      insert into public.conversations(status) values('active') returning id into new_conversation;
      insert into public.conversation_participants(conversation_id,profile_id) values(new_conversation,p_profile_id),(new_conversation,candidate_id);
      update public.match_queue set matched_conversation_id=new_conversation where profile_id in(p_profile_id,candidate_id) and status='matched';
      return query select new_conversation,candidate_id; return;
    end if;
  end loop;
end;
$$;

grant execute on function public.match_next(uuid) to authenticated;
