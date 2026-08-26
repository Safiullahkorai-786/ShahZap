-- FIX: removing a reaction also stripped the user from OTHER emoji lists,
-- effectively removing ALL their reactions instead of just the targeted one.
--
-- Root cause: the "one-reaction-per-person: strip me from other emoji lists"
-- step ran unconditionally — even when the user was REMOVING a reaction.
-- It should only run when ADDING a new emoji (to enforce one-per-person).
-- When removing, we only touch the targeted emoji.

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
    -- Do NOT strip from other emojis — those are separate reactions.
    emoji_arr := (
      select coalesce(jsonb_agg(emoji_arr -> j), '[]'::jsonb)
      from generate_series(0, jsonb_array_length(emoji_arr) - 1) g(j)
      where emoji_arr -> j <> to_jsonb(uid::text)
    );
  else
    -- ADDING a new reaction: first strip me from every OTHER emoji
    -- (one-reaction-per-person rule), then add me to the target.
    select coalesce(jsonb_agg(nr.value), '{}'::jsonb)
      into next_reactions
      from jsonb_each(next_reactions) nr
      where nr.key <> p_emoji
        and not exists (
          select 1
          from jsonb_array_elements(nr.value) el
          where el = to_jsonb(uid::text)
        );
    emoji_arr := coalesce(next_reactions -> p_emoji, '[]'::jsonb);
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
