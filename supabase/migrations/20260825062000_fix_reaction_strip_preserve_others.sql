-- FIX: the "strip me from other emojis" step used NOT EXISTS to exclude
-- entire entries containing my userId. This nuked the whole emoji entry,
-- removing OTHER users' reactions too.
--
-- Fix: for each other emoji, strip ONLY my userId from the array
-- and keep the entry if other users remain.

create or replace function private.toggle_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid uuid := auth.uid();
  target public.messages;
  next_reactions jsonb;
  emoji_arr jsonb;
  already_had boolean;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  if p_emoji is null or length(btrim(p_emoji)) = 0 or length(p_emoji) > 16 then
    raise exception 'invalid_emoji';
  end if;

  select * into target from public.messages m where m.id = p_message_id;
  if target.id is null then raise exception 'message_not_found'; end if;
  if not private.is_conversation_participant(target.conversation_id, uid) then
    raise exception 'forbidden';
  end if;

  next_reactions := coalesce(target.reactions, '{}'::jsonb);

  -- Check whether I already reacted with this emoji.
  emoji_arr := coalesce(next_reactions -> p_emoji, '[]'::jsonb);
  select exists (
    select 1
    from jsonb_array_elements(emoji_arr) el
    where el = to_jsonb(uid::text)
  ) into already_had;

  if already_had then
    -- REMOVING my reaction: just drop me from this emoji's array.
    emoji_arr := (
      select coalesce(jsonb_agg(emoji_arr -> j), '[]'::jsonb)
      from generate_series(0, jsonb_array_length(emoji_arr) - 1) g(j)
      where emoji_arr -> j <> to_jsonb(uid::text)
    );
  else
    -- ADDING a new reaction:
    -- 1. Preserve the target emoji's existing array.
    -- 2. For each OTHER emoji, strip only my userId from its array
    --    (keeping the entry if other users remain).
    -- 3. Append me to the target.
    emoji_arr := coalesce(next_reactions -> p_emoji, '[]'::jsonb);

    select coalesce(jsonb_object_agg(sub.k, sub.v), '{}'::jsonb)
      into next_reactions
      from (
        select
          nr.key as k,
          (
            select coalesce(jsonb_agg(el), '[]'::jsonb)
            from jsonb_array_elements(nr.value) el
            where el <> to_jsonb(uid::text)
          ) as v
        from jsonb_each(target.reactions) nr
        where nr.key <> p_emoji
      ) sub
      where jsonb_array_length(sub.v) > 0;

    emoji_arr := emoji_arr || to_jsonb(uid::text);
  end if;

  -- Update or remove the emoji key.
  if jsonb_array_length(emoji_arr) = 0 then
    next_reactions := next_reactions - p_emoji;
  else
    next_reactions := jsonb_set(next_reactions, array[p_emoji], emoji_arr, true);
  end if;

  update public.messages set reactions = next_reactions where id = p_message_id;
  return next_reactions;
end
$fn$;

create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
begin
  return private.toggle_reaction(p_message_id, p_emoji);
end
$f$;

revoke all on function public.toggle_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;
