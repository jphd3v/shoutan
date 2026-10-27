-- Finished-game records learn `meta.tookBack`: the owner took a move back in a game against the bot, so the
-- game moved no rating (`src/go/finished.ts`). Such a record carries no rating; every record the server
-- accepted before is still accepted.
create or replace function public.valid_game_record(r jsonb) returns boolean -- compatible: accepts every record it did before, and records with `meta.tookBack`
language plpgsql stable set search_path = ''
as $$
declare
  c jsonb;
  m jsonb;
  res jsonb;
  board int;
  handicap int;
  first jsonb;
  colours jsonb := '["black", "white"]';
  -- Lower case, as the phone and the server write ids.
  uuid_pattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  komi numeric;
begin
  if jsonb_typeof(r) is distinct from 'object' or public.record_int(r -> 'format') is distinct from 1
    or not public.record_keys(r, '{format,id,startedAt,endedAt,core,meta}') then
    return false;
  end if;
  if jsonb_typeof(r -> 'id') is distinct from 'string' or (r ->> 'id') !~ uuid_pattern then
    return false;
  end if;
  if not public.record_utc(r -> 'startedAt') or not public.record_utc(r -> 'endedAt')
    or public.record_time(r -> 'startedAt') > public.record_time(r -> 'endedAt') then
    return false;
  end if;

  c := r -> 'core';
  -- Rules from this app's version (`RULES_VERSION`) to far beyond any there will be.
  if jsonb_typeof(c) is distinct from 'object'
    or not public.record_keys(c, '{rules,size,komi,setup,first,moves,dead,result}')
    or coalesce(public.record_int(c -> 'rules') not between 4 and 1000, true)
    or coalesce(public.record_int(c -> 'size') not in (9, 13, 19), true) then
    return false;
  end if;
  board := public.record_int(c -> 'size');
  if not public.record_half(c -> 'komi') then
    return false;
  end if;
  komi := (c ->> 'komi')::numeric;
  if abs(komi) >= board * board then
    return false;
  end if;
  if jsonb_typeof(c -> 'setup') is distinct from 'object' or not public.record_keys(c -> 'setup', '{black,white}')
    or not public.record_points(c #> '{setup,black}', 0, board, board * board)
    or jsonb_typeof(c #> '{setup,white}') is distinct from 'array' or jsonb_array_length(c #> '{setup,white}') <> 0
    or not public.record_points(c -> 'moves', -1, board, 2147483647)
    or not public.record_points(c -> 'dead', 0, board, board * board) then
    return false;
  end if;
  -- Every game starts as the app sets it up: Black's handicap stones, if any, and then White moves first.
  first := case when jsonb_array_length(c #> '{setup,black}') > 0 then '"white"' else '"black"' end;
  if not public.record_ascending(c -> 'dead') or c -> 'first' is distinct from first then
    return false;
  end if;

  res := c -> 'result';
  if jsonb_typeof(res) is distinct from 'object' or not public.record_keys(res, '{winner,reason,margin}')
    or jsonb_typeof(res -> 'winner') is distinct from 'string' or not colours @> jsonb_build_array(res -> 'winner') then
    return false;
  end if;
  if res -> 'reason' = '"score"' then
    -- Areas and komi bound the margin: no side has more than the board.
    if not public.record_half(res -> 'margin') or (res ->> 'margin')::numeric <= 0
      or (res ->> 'margin')::numeric > board * board + abs(komi) then
      return false;
    end if;
  elsif res -> 'reason' = '"resign"' then
    if jsonb_typeof(res -> 'margin') is distinct from 'null' or jsonb_array_length(c -> 'dead') > 0 then
      return false;
    end if;
  else
    return false;
  end if;

  m := r -> 'meta';
  if jsonb_typeof(m) is distinct from 'object' or not public.record_keys(m, '{player,mode,onlineGame,opponent,you,handicap,rating,coached,tookBack}')
    or jsonb_typeof(m -> 'mode') is distinct from 'string' or (m ->> 'mode') not in ('bot', 'face_to_face', 'online') then
    return false;
  end if;
  -- The owner's account id: absent for a game played signed out, always there online.
  if m ? 'player' and (jsonb_typeof(m -> 'player') <> 'string' or (m ->> 'player') !~ uuid_pattern) then
    return false;
  end if;
  if m ->> 'mode' = 'online' then
    if not m ? 'player'
      or jsonb_typeof(m -> 'onlineGame') is distinct from 'string' or (m ->> 'onlineGame') !~ uuid_pattern
      or jsonb_typeof(m -> 'opponent') is distinct from 'string' or (m ->> 'opponent') !~ uuid_pattern
      or m -> 'opponent' = m -> 'player' then
      return false;
    end if;
  elsif m ? 'onlineGame' or m ? 'opponent' then
    return false;
  end if;
  if m ->> 'mode' = 'face_to_face' then
    if jsonb_typeof(m -> 'you') is distinct from 'null' then
      return false;
    end if;
  elsif jsonb_typeof(m -> 'you') is distinct from 'string' or not colours @> jsonb_build_array(m -> 'you') then
    return false;
  end if;
  -- Up to five stones on 9×9 and nine on larger boards, each on its point.
  if coalesce(public.record_int(m -> 'handicap') not between 0 and (case when board < 13 then 5 else 9 end), true) then
    return false;
  end if;
  handicap := public.record_int(m -> 'handicap');
  if c #> '{setup,black}' is distinct from public.record_handicap_stones(board, handicap) then
    return false;
  end if;
  if m ? 'rating' and not (
    jsonb_typeof(m -> 'rating') = 'object' and public.record_keys(m -> 'rating', '{before,after,opponent}')
    and public.record_rating(m #> '{rating,before}') and public.record_rating(m #> '{rating,after}')
    and public.record_rating(m #> '{rating,opponent}')
  ) then
    return false;
  end if;
  -- A game played with the Coach moved no rating.
  if m ? 'coached' and (m -> 'coached' is distinct from 'true'::jsonb or m ? 'rating') then
    return false;
  end if;
  -- Nor did a game against the bot in which the owner took a move back.
  if m ? 'tookBack' and (m -> 'tookBack' is distinct from 'true'::jsonb or m ? 'rating' or m ->> 'mode' <> 'bot') then
    return false;
  end if;
  return true;
end;
$$;
