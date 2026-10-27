-- Go's database: family members, online games, finished-game records, ratings and reports.
--
-- Family members sign in with email and join with the family code. Both phones run the same rules
-- and replay each online game's hash-chained events (`src/online/log.ts`), so the database is a
-- strict referee for everything except board legality and score arithmetic: membership, seats,
-- turn order, event shape and order, and the phase machine. Clients read through RLS and write
-- only through the security-definer functions below.
--
-- Roles:
-- - go_owner owns Go's tables and functions. The security-definer functions run as go_owner, so a
--   bug in one can reach Go's tables and whatever a signed-in phone (`authenticated`, which
--   go_owner inherits so that auth.uid() works) may already reach, nothing more. It cannot log in.
-- - go_reports is the login for the owner's report polling and the release checks. It may read
--   reports and set their status and notes, and read which migrations are installed. It cannot
--   see players, games, family codes or anything outside Go. `npm run infra` sets its password.
-- Roles are shared by every schema Go is installed in; grants are per schema.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'go_owner') then
    create role go_owner nologin inherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'go_reports') then
    create role go_reports login noinherit;
  end if;
end;
$$;

grant authenticated to go_owner;
-- Lets later migrations, which run as postgres, replace go_owner's functions.
grant go_owner to postgres;
grant usage, create on schema public to go_owner;

-- ── Tables ────────────────────────────────────────────────────────────────────

create table public.settings (
  key text primary key,
  value text not null
);

create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 24),
  -- An emoji the player picks on their phone; null until they pick one.
  avatar text check (char_length(avatar) between 1 and 16),
  -- The level the player chose and when; their rating is worked out from their records since then.
  level text check (level in ('never', 'basics', 'beginner', 'casual', 'intermediate', 'club', 'dan')),
  rating_since timestamptz,
  -- On the EGF scale (`src/go/rating.ts`), shown to the family as handicap stones.
  rating numeric check (rating between -900 and 2900),
  rated_games int not null default 0 check (rated_games >= 0),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Names tell family members apart, ignoring case and surrounding spaces.
create unique index players_name_key on public.players (lower(btrim(name)));

create table public.games (
  id uuid primary key default gen_random_uuid(),
  size int not null check (size in (9, 13, 19)),
  komi numeric not null default 7.5,
  handicap int not null default 0 check (handicap between 0 and 9),
  -- `RULES_VERSION` in `src/go/rules.ts`; a newer app may create games under a higher one.
  rules_version int not null default 4 check (rules_version >= 1),
  black uuid references public.players (id) on delete set null,
  white uuid references public.players (id) on delete set null,
  created_by uuid not null references public.players (id) on delete cascade,
  -- When set, only this member may join.
  invited uuid references public.players (id) on delete cascade,
  -- open: waiting for an opponent; playing / scoring / over follow the game's phase; disputed:
  -- a phone found the stored history disagreeing with its replay.
  status text not null default 'open' check (status in ('open', 'playing', 'scoring', 'over', 'disputed')),
  to_play text not null default 'black' check (to_play in ('black', 'white')),
  move_count int not null default 0 check (move_count >= 0),
  -- Written by the client that ended the game; for display only.
  result jsonb,
  head_hash text check (head_hash ~ '^[0-9a-f]{64}$'),
  black_accepted boolean not null default false,
  white_accepted boolean not null default false,
  dispute jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index games_updated_at_idx on public.games (updated_at desc);

create table public.game_events (
  game_id uuid not null references public.games (id) on delete cascade,
  n int not null check (n >= 1),
  player uuid not null references public.players (id) on delete cascade,
  event jsonb not null check (pg_column_size(event) < 4000),
  created_at timestamptz not null default now(),
  primary key (game_id, n)
);

-- Finished games in the record format the app writes (`src/go/finished.ts`), exactly as the phone
-- sent them, unknown fields included, so a later app can read them back whole.
create table public.game_records (
  -- Made on the phone when the game started.
  id uuid primary key,
  player uuid not null references public.players (id) on delete cascade,
  format int not null check (format >= 1),
  record jsonb not null,
  online_game uuid references public.games (id) on delete set null,
  ended_at timestamptz not null,
  app_version text not null check (char_length(app_version) <= 40),
  uploaded_at timestamptz not null default now()
);
create unique index game_records_online_key on public.game_records (player, online_game);
create index game_records_player_idx on public.game_records (player, ended_at desc);
create index game_records_uploaded_idx on public.game_records (player, uploaded_at, id);

create table public.reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('crash', 'error', 'bug', 'idea')),
  message text not null check (char_length(message) between 1 and 4000),
  details jsonb not null default '{}' check (pg_column_size(details) < 64000),
  -- Same fingerprint = same error; the app merges repeats and counts them.
  fingerprint text check (char_length(fingerprint) <= 64),
  occurrences int not null default 1 check (occurrences >= 1),
  app_version text check (char_length(app_version) <= 40),
  player_id uuid default auth.uid(),
  player_name text check (char_length(player_name) <= 24),
  -- The sync files each report as a GitHub issue ('filed') and keeps the issue link in notes.
  status text not null default 'new'
    check (status in ('new', 'filed', 'accepted', 'in_progress', 'proposed', 'on_dev', 'released', 'rejected', 'duplicate')),
  notes text
);
create index reports_status_idx on public.reports (status, created_at);
create index reports_player_idx on public.reports (player_id, created_at);
create index reports_created_at_idx on public.reports (created_at);

-- One row per published APK, so the app can say that a newer version exists.
create table public.releases (
  version_code int primary key,
  version_name text not null,
  notes text not null default '',
  released_at timestamptz not null default now()
);

-- ── Who may read ──────────────────────────────────────────────────────────────

-- A permanent login (email, verified by a one-time code) establishes who someone is. Anonymous
-- sign-in is off for Go, but the project is shared and that setting is project-wide, so the
-- database refuses anonymous tokens itself.
create function public.is_permanent() returns boolean
language sql stable set search_path = ''
as $$ select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false $$;

-- A family member: a permanent login that joined with the family code.
create function public.is_player() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_permanent() and exists (select 1 from public.players where id = auth.uid()) $$;

alter table public.settings enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.game_events enable row level security;
alter table public.game_records enable row level security;
alter table public.reports enable row level security;
alter table public.releases enable row level security;

revoke all on public.settings, public.players, public.games, public.game_events, public.game_records, public.reports,
  public.releases from anon, authenticated;
grant select on public.players, public.games, public.game_events, public.game_records, public.releases to authenticated;
grant insert (kind, message, details, fingerprint, occurrences, app_version, player_name) on public.reports to authenticated;

create policy players_read on public.players for select to authenticated using (public.is_player());
create policy games_read on public.games for select to authenticated using (public.is_player());
create policy events_read on public.game_events for select to authenticated using (public.is_player());
create policy game_records_read on public.game_records for select to authenticated using (player = auth.uid());
create policy releases_read on public.releases for select to authenticated using (true);
-- Feedback and error reports come only from members, within the limits of `limit_reports`.
create policy reports_insert on public.reports for insert to authenticated
  with check (player_id = auth.uid() and status = 'new' and notes is null and public.is_player());

grant usage on schema public to go_reports;
grant select on public.reports to go_reports;
grant update (status, notes) on public.reports to go_reports;
create policy reports_read on public.reports for select to go_reports using (true);
create policy reports_update on public.reports for update to go_reports using (true) with check (true);

-- ── Members ───────────────────────────────────────────────────────────────────

create function public.register_player(p_name text, p_family_code text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  expected text;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select value into expected from public.settings where key = 'family_code';
  if expected is null or p_family_code is distinct from expected then
    raise exception 'wrong_family_code' using errcode = '28000';
  end if;
  insert into public.players (id, name) values (auth.uid(), btrim(p_name))
  on conflict (id) do update set name = excluded.name, updated_at = now();
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
end;
$$;

create function public.rename_player(p_name text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.players set name = btrim(p_name), updated_at = now() where id = auth.uid();
  if not found then
    raise exception 'not_a_player' using errcode = '28000';
  end if;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
end;
$$;

create function public.set_my_avatar(p_avatar text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_player() then
    raise exception 'not_a_player' using errcode = '28000';
  end if;
  if p_avatar is not null and char_length(p_avatar) not between 1 and 16 then
    raise exception 'bad_avatar' using errcode = '22023';
  end if;
  update public.players set avatar = p_avatar, updated_at = now() where id = auth.uid();
end;
$$;

-- A phone with Play online open says so every little while, and the family sees who is online or
-- was lately. At most one write every 10 seconds per player, however often a phone calls. Returns
-- the server's clock, so a phone with a wrong clock still judges "online now" by the server's time.
create function public.touch_presence() returns timestamptz
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_player() then
    raise exception 'not_a_player' using errcode = '28000';
  end if;
  update public.players set last_seen_at = now()
    where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '10 seconds');
  return now();
end;
$$;

-- ── Online games ──────────────────────────────────────────────────────────────

-- Must match genesis() in src/online/log.ts.
create function public.genesis_hash(g public.games) returns text
language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(
    format('go-online|rules %s|%s|%s|%s|handicap %s|chinese', g.rules_version, g.id, g.size, g.komi, g.handicap),
    'UTF8')), 'hex')
$$;

create function public.is_board_point(v jsonb, cells int) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[0-9]+$' and (v #>> '{}')::numeric < cells
$$;

-- Komi and who moves first follow newGame() in src/go/rules.ts: one stone means Black plays first
-- with ½ komi; 2 to 9 stones (at most 5 on 9×9) go on the star points, White plays first, and komi
-- is ½ plus a point per stone.
create function public.create_game(p_size int, p_color text, p_handicap int) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  game_id uuid;
begin
  if not public.is_player() then
    raise exception 'not_a_player' using errcode = '28000';
  end if;
  if p_color not in ('black', 'white') then
    raise exception 'bad_color' using errcode = '22023';
  end if;
  if p_handicap is null or p_handicap < 0 or p_handicap > 9 or (p_size < 13 and p_handicap > 5) then
    raise exception 'bad_setup' using errcode = '22023';
  end if;
  insert into public.games (size, komi, black, white, created_by, rules_version, handicap, to_play)
  values (
    p_size,
    case when p_handicap = 0 then 7.5 when p_handicap = 1 then 0.5 else 0.5 + p_handicap end,
    case when p_color = 'black' then auth.uid() end,
    case when p_color = 'white' then auth.uid() end,
    auth.uid(),
    4,
    p_handicap,
    case when p_handicap > 1 then 'white' else 'black' end
  )
  returning id into game_id;
  return game_id;
end;
$$;

-- A game addressed to one member: only they can join it, and the others do not list it.
create function public.ask_to_play(p_player uuid, p_size int, p_color text, p_handicap int) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  game_id uuid;
begin
  if not public.is_player() then
    raise exception 'not_a_player' using errcode = '28000';
  end if;
  if p_player = auth.uid() or not exists (select 1 from public.players where id = p_player) then
    raise exception 'bad_player' using errcode = '22023';
  end if;
  game_id := public.create_game(p_size, p_color, p_handicap);
  update public.games set invited = p_player where id = game_id;
  return game_id;
end;
$$;

create function public.join_game(p_game uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
begin
  if not public.is_player() then
    raise exception 'not_a_player' using errcode = '28000';
  end if;
  select * into g from public.games where id = p_game for update;
  if g.id is null or g.status <> 'open' then
    raise exception 'game_not_open' using errcode = 'P0002';
  end if;
  if g.created_by = auth.uid() then
    raise exception 'own_game' using errcode = '22023';
  end if;
  if g.invited is not null and g.invited <> auth.uid() then
    raise exception 'not_invited' using errcode = '42501';
  end if;
  update public.games
  set black = coalesce(black, auth.uid()),
      white = coalesce(white, auth.uid()),
      status = 'playing',
      updated_at = now()
  where id = p_game;
end;
$$;

create function public.cancel_game(p_game uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.games where id = p_game and created_by = auth.uid() and status = 'open';
  if not found then
    raise exception 'game_not_open' using errcode = 'P0002';
  end if;
end;
$$;

-- Appends event number p_n. The caller has already applied it with the shared rules and passes
-- the resulting status, side to move and result. A stale p_n or `prev` means the caller missed an
-- event and must reload (errcode 40001). Checked here:
-- - each event extends the current chain head (`prev`), starting from `genesis_hash`;
-- - each kind has an exact shape, and points are on the board;
-- - the phase machine: who may act, when scoring starts, what status, side to move and result each
--   kind leads to, and that the game ends by score only after both players accept.
create function public.add_event(p_game uuid, p_n int, p_event jsonb, p_status text, p_to_play text, p_result jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
  me text;
  them text;
  kind text := p_event ->> 'kind';
  keys text;
  cells int;
  last_kind text;
  dead jsonb;
  mine_accepted boolean;
  theirs_accepted boolean;
  next_black_accepted boolean;
  next_white_accepted boolean;
begin
  select * into g from public.games where id = p_game for update;
  if g.id is null then
    raise exception 'no_such_game' using errcode = 'P0002';
  end if;
  me := case when g.black = auth.uid() then 'black' when g.white = auth.uid() then 'white' end;
  if me is null then
    raise exception 'not_your_game' using errcode = '42501';
  end if;
  them := case me when 'black' then 'white' else 'black' end;
  if p_n <> g.move_count + 1 then
    raise exception 'out_of_sync' using errcode = '40001';
  end if;
  if g.status = 'disputed' then
    raise exception 'game_disputed' using errcode = '22023';
  end if;
  if g.status not in ('playing', 'scoring') then
    raise exception 'game_not_running' using errcode = '22023';
  end if;

  -- Shape of the event.
  if jsonb_typeof(p_event) <> 'object' or p_event ->> 'color' is distinct from me then
    raise exception 'wrong_color' using errcode = '42501';
  end if;
  if (p_event ->> 'prev') is distinct from coalesce(g.head_hash, public.genesis_hash(g)) then
    -- The caller built on a history other than the stored one; it must reload.
    raise exception 'broken_chain' using errcode = '40001';
  end if;
  if coalesce(p_event ->> 'hash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'bad_event' using errcode = '22023';
  end if;
  select string_agg(k, ',' order by k) into keys from jsonb_object_keys(p_event) as k;
  cells := g.size * g.size;
  dead := p_event -> 'dead';
  if not (
    (kind in ('play', 'mark') and keys = 'color,hash,kind,point,prev' and public.is_board_point(p_event -> 'point', cells))
    or (kind = 'pass' and keys = 'color,hash,kind,prev')
    or (kind = 'pass' and keys = 'color,dead,hash,kind,prev' and jsonb_typeof(dead) = 'array'
        and not exists (select 1 from jsonb_array_elements(dead) as e where not public.is_board_point(e, cells)))
    or (kind in ('resign', 'accept', 'resume') and keys = 'color,hash,kind,prev')
  ) then
    raise exception 'bad_event' using errcode = '22023';
  end if;

  -- The phase machine.
  if p_result = 'null'::jsonb then
    p_result := null;
  end if;
  mine_accepted := case me when 'black' then g.black_accepted else g.white_accepted end;
  theirs_accepted := case me when 'black' then g.white_accepted else g.black_accepted end;
  next_black_accepted := g.black_accepted;
  next_white_accepted := g.white_accepted;

  if kind in ('play', 'pass') then
    if g.status <> 'playing' or g.to_play <> me then
      raise exception 'not_your_turn' using errcode = '22023';
    end if;
    select e.event ->> 'kind' into last_kind from public.game_events e where e.game_id = p_game and e.n = g.move_count;
    if kind = 'pass' and last_kind = 'pass' then
      -- The second pass in a row starts scoring and must carry the dead-stone suggestion.
      if dead is null or p_status <> 'scoring' then
        raise exception 'bad_summary' using errcode = '22023';
      end if;
    elsif dead is not null or p_status <> 'playing' then
      raise exception 'bad_summary' using errcode = '22023';
    end if;
    if p_to_play <> them or p_result is not null then
      raise exception 'bad_summary' using errcode = '22023';
    end if;
    next_black_accepted := false;
    next_white_accepted := false;
  elsif kind = 'resign' then
    if p_status <> 'over' or p_to_play <> g.to_play
       or p_result is distinct from jsonb_build_object('winner', them, 'reason', 'resignation') then
      raise exception 'bad_summary' using errcode = '22023';
    end if;
  elsif g.status <> 'scoring' then
    raise exception 'not_scoring' using errcode = '22023';
  elsif kind = 'mark' then
    if p_status <> 'scoring' or p_to_play <> g.to_play or p_result is not null then
      raise exception 'bad_summary' using errcode = '22023';
    end if;
    next_black_accepted := false;
    next_white_accepted := false;
  elsif kind = 'accept' then
    if mine_accepted then
      raise exception 'already_accepted' using errcode = '22023';
    end if;
    if theirs_accepted then
      if p_status <> 'over' or p_to_play <> g.to_play or p_result ->> 'reason' is distinct from 'score'
         or p_result ->> 'winner' not in ('black', 'white') then
        raise exception 'bad_summary' using errcode = '22023';
      end if;
    elsif p_status <> 'scoring' or p_to_play <> g.to_play or p_result is not null then
      raise exception 'bad_summary' using errcode = '22023';
    end if;
    if me = 'black' then
      next_black_accepted := true;
    else
      next_white_accepted := true;
    end if;
  elsif kind = 'resume' then
    if p_status <> 'playing' or p_to_play <> g.to_play or p_result is not null then
      raise exception 'bad_summary' using errcode = '22023';
    end if;
    next_black_accepted := false;
    next_white_accepted := false;
  end if;

  insert into public.game_events (game_id, n, player, event) values (p_game, p_n, auth.uid(), p_event);
  update public.games
  set move_count = p_n,
      status = p_status,
      to_play = p_to_play,
      result = p_result,
      head_hash = p_event ->> 'hash',
      black_accepted = next_black_accepted,
      white_accepted = next_white_accepted,
      updated_at = now()
  where id = p_game;
end;
$$;

-- Called by a phone whose replay disagrees with the stored history at event p_n. Stops the game
-- for both players; the owner reviews it through the automatic report. Only a game still being
-- played or scored can be stopped, at an event it has, so a finished game keeps its result.
create function public.dispute_game(p_game uuid, p_n int, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if g.id is null or auth.uid() is null or auth.uid() not in (g.black, g.white) then
    raise exception 'not_your_game' using errcode = '42501';
  end if;
  if g.status = 'disputed' then
    return;
  end if;
  if g.status not in ('playing', 'scoring') then
    raise exception 'game_not_running' using errcode = '22023';
  end if;
  if p_n is null or p_n < 0 or p_n > g.move_count then
    raise exception 'bad_event' using errcode = '22023';
  end if;
  update public.games
  set status = 'disputed',
      dispute = jsonb_build_object('n', p_n, 'reason', left(p_reason, 200), 'by', auth.uid(), 'at', now(), 'status_before', g.status),
      updated_at = now()
  where id = p_game;
end;
$$;

-- ── Limits ────────────────────────────────────────────────────────────────────
-- The project is shared with other apps, and its publishable key ships in every APK.

-- One user sends at most 50 reports an hour, a whole queue from the app, and the project takes at
-- most `reports_per_day` (in settings, 500 when unset) from everyone together. A refused batch
-- stays queued on the phone and goes out once the window allows.
create function public.limit_reports() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  per_day int;
begin
  if (select count(*) from public.reports where player_id = auth.uid() and created_at > now() - interval '1 hour') > 50 then
    raise exception 'too_many_reports' using errcode = '54000';
  end if;
  select coalesce((select value::int from public.settings where key = 'reports_per_day'), 500) into per_day;
  if (select count(*) from public.reports where created_at > now() - interval '1 day') > per_day then
    raise exception 'too_many_reports' using errcode = '54000';
  end if;
  return null;
end;
$$;

-- At most 10 open games per creator, so no one clutters the lobby.
create function public.limit_open_games() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.games where created_by = new.created_by and status = 'open') >= 10 then
    raise exception 'too_many_open_games' using errcode = '54000';
  end if;
  return new;
end;
$$;

-- At most 2000 events per game, which every phone replays; a long 19×19 game with its marking
-- stays well below.
create function public.limit_game_events() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.n > 2000 then
    raise exception 'game_too_long' using errcode = '54000';
  end if;
  return new;
end;
$$;

-- Stops an anonymous token writing any Go table, which covers the functions that check a seat
-- instead of membership.
create function public.reject_anonymous() returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- The claims setting itself, not auth.jwt(): the reports login may not use the auth schema.
  if coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  return null;
end;
$$;

create trigger reports_limit after insert on public.reports
  for each statement execute function public.limit_reports();
create trigger games_open_limit before insert on public.games
  for each row execute function public.limit_open_games();
create trigger game_events_limit before insert on public.game_events
  for each row execute function public.limit_game_events();
create trigger players_permanent before insert or update or delete on public.players
  for each statement execute function public.reject_anonymous();
create trigger games_permanent before insert or update or delete on public.games
  for each statement execute function public.reject_anonymous();
create trigger game_events_permanent before insert or update or delete on public.game_events
  for each statement execute function public.reject_anonymous();
create trigger game_records_permanent before insert or update or delete on public.game_records
  for each statement execute function public.reject_anonymous();
create trigger reports_permanent before insert or update or delete on public.reports
  for each statement execute function public.reject_anonymous();

-- ── Finished-game records ─────────────────────────────────────────────────────
-- `valid_game_record` accepts exactly what the phone's `readFinished` reads; the golden records in
-- `src/go/__tests__/records/` are checked against both (`supabase/tests/online.test.ts`). One
-- spelling for every record, so a record means one thing and equal records are equal JSON: times
-- in UTC to the millisecond (`toISOString`), point sets in ascending order, numbers as
-- `JSON.stringify` writes them, and no field the server has not learned.

-- A record's time: ISO 8601 with a zone, as the phone's `instant` reads it; null otherwise.
create function public.record_time(t jsonb) returns timestamptz
language plpgsql stable set search_path = ''
as $$
begin
  if jsonb_typeof(t) is distinct from 'string'
    or (t #>> '{}') !~ '^[12][0-9]{3}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
    return null;
  end if;
  return (t #>> '{}')::timestamptz;
exception
  when invalid_datetime_format or datetime_field_overflow then
    return null;
end;
$$;

-- A time as `toISOString` writes it.
create function public.record_utc(t jsonb) returns boolean
language sql stable set search_path = ''
as $$
  select jsonb_typeof(t) = 'string'
    and (t #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    and public.record_time(t) is not null
$$;

-- A whole number, as `JSON.stringify` writes one; null for anything else.
create function public.record_int(x jsonb) returns numeric
language sql immutable set search_path = ''
as $$ select case when jsonb_typeof(x) = 'number' and x::text ~ '^(0|-?[1-9][0-9]*)$' then x::numeric end $$;

-- A number ending in .5, as komi and every score margin do, as `JSON.stringify` writes one.
create function public.record_half(x jsonb) returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(jsonb_typeof(x) = 'number' and x::text ~ '^-?(0|[1-9][0-9]{0,5})\.5$', false) $$;

-- A rating: a whole number, bounded far beyond any rating scale (the phone's `RATING_LIMIT`).
create function public.record_rating(x jsonb) returns boolean
language sql immutable set search_path = ''
as $$ select coalesce(abs(public.record_int(x)) <= 100000, false) $$;

-- A list of points on a board of `size`, each a whole number from `lo`, at most `most` of them.
create function public.record_points(a jsonb, lo int, size int, most int) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_typeof(a) = 'array', false)
    and case when jsonb_typeof(a) = 'array' then
      jsonb_array_length(a) <= most
      and not exists (
        select 1 from jsonb_array_elements(a) e
        where coalesce(public.record_int(e) not between lo and size * size - 1, true)
      )
    else false end
$$;

-- Points on the board in ascending order, each once, in a list already checked with `record_points`.
create function public.record_ascending(a jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select not exists (
    select 1 from jsonb_array_elements(a) with ordinality e(p, i)
    join jsonb_array_elements(a) with ordinality f(q, j) on j = i + 1
    where (f.q)::numeric <= (e.p)::numeric
  )
$$;

-- True when the object has no key outside `known`.
create function public.record_keys(x jsonb, known text[]) returns boolean
language sql immutable set search_path = ''
as $$ select not exists (select 1 from jsonb_object_keys(x) k where k <> all (known)) $$;

-- The setup of a game with `n` handicap stones, in ascending order: the app's `handicapPoints`.
-- One stone is no stone: Black moves first with less komi.
create function public.record_handicap_stones(board int, n int) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce((select s.points from (values
    (9, 2, '[24,56]'::jsonb), (9, 3, '[24,56,60]'), (9, 4, '[20,24,56,60]'), (9, 5, '[20,24,40,56,60]'),
    (13, 2, '[48,120]'), (13, 3, '[48,120,126]'), (13, 4, '[42,48,120,126]'), (13, 5, '[42,48,84,120,126]'),
    (13, 6, '[42,48,81,87,120,126]'), (13, 7, '[42,48,81,84,87,120,126]'),
    (13, 8, '[42,45,48,81,87,120,123,126]'), (13, 9, '[42,45,48,81,84,87,120,123,126]'),
    (19, 2, '[72,288]'), (19, 3, '[72,288,300]'), (19, 4, '[60,72,288,300]'), (19, 5, '[60,72,180,288,300]'),
    (19, 6, '[60,72,174,186,288,300]'), (19, 7, '[60,72,174,180,186,288,300]'),
    (19, 8, '[60,66,72,174,186,288,294,300]'), (19, 9, '[60,66,72,174,180,186,288,294,300]')
  ) s(board, n, points) where s.board = record_handicap_stones.board and s.n = record_handicap_stones.n),
  case when n < 2 then '[]'::jsonb end)
$$;

-- The phone's `readFinished`, for format 1: true for exactly the records it reads, as a game or,
-- under rules newer than it knows, as a newer record (the server keeps those too; it never
-- replays), when they carry no field the server has not learned. The server learns each format,
-- and each field added to one, before an app writes it. Checks run one after another, so nothing
-- is cast before its type is known.
create function public.valid_game_record(r jsonb) returns boolean
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
  if jsonb_typeof(m) is distinct from 'object' or not public.record_keys(m, '{player,mode,onlineGame,opponent,you,handicap,rating}')
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
  return true;
end;
$$;

-- Keeps one finished game of the player who sends it (`meta.player`). Sending it again changes
-- nothing, and a recount on the phone replaces the record under the same id; only the player who
-- sent it can, and only for the same game. An online game is kept once per player, whatever id a
-- phone gave it, and only as the server's game was played: the sender's seat and colour, and the
-- other seat's player as the opponent.
create function public.record_game(p jsonb, version text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  online uuid;
  done int;
begin
  if not public.is_player() then
    raise exception 'not_a_player' using errcode = '28000';
  end if;
  if octet_length(p::text) > 1048576 or not public.valid_game_record(p)
    or version is null or char_length(version) > 40 then
    raise exception 'bad_game' using errcode = '22023';
  end if;
  if p #>> '{meta,player}' is distinct from auth.uid()::text then
    raise exception 'not_your_game' using errcode = '28000';
  end if;
  online := (p #>> '{meta,onlineGame}')::uuid;
  if online is not null and not exists (
    select 1 from public.games g
    where g.id = online and (
      (g.black = auth.uid() and g.white::text = p #>> '{meta,opponent}' and p #>> '{meta,you}' = 'black')
      or (g.white = auth.uid() and g.black::text = p #>> '{meta,opponent}' and p #>> '{meta,you}' = 'white')
    )
  ) then
    raise exception 'not_your_game' using errcode = '28000';
  end if;
  begin
    insert into public.game_records as kept (id, player, format, record, online_game, ended_at, app_version)
    values ((p ->> 'id')::uuid, auth.uid(), 1, p, online, public.record_time(p -> 'endedAt'), version)
    on conflict (id) do update
      set record = excluded.record, format = excluded.format, ended_at = excluded.ended_at,
        app_version = excluded.app_version, uploaded_at = now()
      where kept.player = excluded.player
        and kept.online_game is not distinct from excluded.online_game
        and kept.record #>> '{meta,mode}' = excluded.record #>> '{meta,mode}';
    get diagnostics done = row_count;
  exception
    when unique_violation then
      -- This player's record of the same online game, kept under another id.
      return;
  end;
  if done = 0 then
    raise exception 'not_your_game' using errcode = '28000';
  end if;
end;
$$;

-- The player's own records changed after a point, oldest change first, a page at a time: the
-- phone passes the last change it has (`uploaded_at`, `id`), or null for everything.
create function public.my_game_records(p_after timestamptz, p_after_id uuid, p_limit int)
returns table (id uuid, record jsonb, uploaded_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.record, r.uploaded_at
  from public.game_records r
  where public.is_player() and r.player = auth.uid()
    and (p_after is null or (r.uploaded_at, r.id) > (p_after, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by r.uploaded_at, r.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- ── Ratings ───────────────────────────────────────────────────────────────────
-- A player's rating is the starting rating of their level (`src/go/rating.ts`) plus what each of
-- their records since the level was chosen moved it (`meta.rating.after - before`), so two phones
-- on one account agree on it. A record is kept once per game id (and once per online game), so
-- sending it again or recounting it never counts it twice.

-- The rating a new player of `level` starts from: `START` in `src/go/rating.ts`.
create function public.level_rating(level text) returns int
language sql immutable set search_path = ''
as $$
  select case level
    when 'never' then -900 when 'basics' then -350 when 'beginner' then 150 when 'casual' then 650
    when 'intermediate' then 1150 when 'club' then 1650 when 'dan' then 2150
  end
$$;

-- Works out a player's rating and rated games from their records since they chose their level.
-- A player whose phone has not reported a level yet has no rating.
create function public.refresh_rating(who uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p record;
  moved numeric;
  n int;
begin
  select level, rating_since into p from public.players where id = who;
  if p.level is null then
    return;
  end if;
  select coalesce(sum((r.record #>> '{meta,rating,after}')::numeric - (r.record #>> '{meta,rating,before}')::numeric), 0), count(*)
    into moved, n
    from public.game_records r
    where r.player = who and r.record #> '{meta,rating}' is not null and r.ended_at >= p.rating_since;
  update public.players
    set rating = least(2900, greatest(-900, public.level_rating(p.level) + moved)), rated_games = n, updated_at = now()
    where id = who;
end;
$$;

create function public.game_records_rating() returns trigger
language plpgsql set search_path = ''
as $$
begin
  perform public.refresh_rating(new.player);
  return null;
end;
$$;

create trigger game_records_rating after insert or update on public.game_records
  for each row execute function public.game_records_rating();

-- The level the player chose and when, from their phone. An older choice than the one stored
-- changes nothing, so a phone sending it again, or late, is harmless. A time from the future
-- (beyond a phone clock's usual error) is refused.
create function public.set_my_level(p_level text, p_since timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_player() then
    raise exception 'not_a_player' using errcode = '28000';
  end if;
  if public.level_rating(p_level) is null or p_since is null or p_since > now() + interval '1 day' then
    raise exception 'bad_level' using errcode = '22023';
  end if;
  update public.players set level = p_level, rating_since = p_since, updated_at = now()
    where id = auth.uid() and (rating_since is null or rating_since < p_since);
  perform public.refresh_rating(auth.uid());
end;
$$;

-- ── Ownership and privileges ──────────────────────────────────────────────────

alter table public.settings owner to go_owner;
alter table public.players owner to go_owner;
alter table public.games owner to go_owner;
alter table public.game_events owner to go_owner;
alter table public.game_records owner to go_owner;
alter table public.reports owner to go_owner;
alter table public.releases owner to go_owner;

alter function public.is_permanent() owner to go_owner;
alter function public.is_player() owner to go_owner;
alter function public.register_player(text, text) owner to go_owner;
alter function public.rename_player(text) owner to go_owner;
alter function public.set_my_avatar(text) owner to go_owner;
alter function public.touch_presence() owner to go_owner;
alter function public.genesis_hash(public.games) owner to go_owner;
alter function public.is_board_point(jsonb, int) owner to go_owner;
alter function public.create_game(int, text, int) owner to go_owner;
alter function public.ask_to_play(uuid, int, text, int) owner to go_owner;
alter function public.join_game(uuid) owner to go_owner;
alter function public.cancel_game(uuid) owner to go_owner;
alter function public.add_event(uuid, int, jsonb, text, text, jsonb) owner to go_owner;
alter function public.dispute_game(uuid, int, text) owner to go_owner;
alter function public.limit_reports() owner to go_owner;
alter function public.limit_open_games() owner to go_owner;
alter function public.limit_game_events() owner to go_owner;
alter function public.reject_anonymous() owner to go_owner;
alter function public.record_time(jsonb) owner to go_owner;
alter function public.record_utc(jsonb) owner to go_owner;
alter function public.record_int(jsonb) owner to go_owner;
alter function public.record_half(jsonb) owner to go_owner;
alter function public.record_rating(jsonb) owner to go_owner;
alter function public.record_points(jsonb, int, int, int) owner to go_owner;
alter function public.record_ascending(jsonb) owner to go_owner;
alter function public.record_keys(jsonb, text[]) owner to go_owner;
alter function public.record_handicap_stones(int, int) owner to go_owner;
alter function public.valid_game_record(jsonb) owner to go_owner;
alter function public.record_game(jsonb, text) owner to go_owner;
alter function public.my_game_records(timestamptz, uuid, int) owner to go_owner;
alter function public.level_rating(text) owner to go_owner;
alter function public.refresh_rating(uuid) owner to go_owner;
alter function public.game_records_rating() owner to go_owner;
alter function public.set_my_level(text, timestamptz) owner to go_owner;

revoke execute on all functions in schema public from public, anon;
-- Only the trigger works a rating out.
revoke execute on function public.refresh_rating(uuid) from authenticated;
grant execute on function public.is_permanent(), public.is_player(), public.register_player(text, text),
  public.rename_player(text), public.set_my_avatar(text), public.touch_presence(), public.genesis_hash(public.games),
  public.is_board_point(jsonb, int), public.create_game(int, text, int), public.ask_to_play(uuid, int, text, int),
  public.join_game(uuid), public.cancel_game(uuid), public.add_event(uuid, int, jsonb, text, text, jsonb),
  public.dispute_game(uuid, int, text), public.record_game(jsonb, text), public.my_game_records(timestamptz, uuid, int),
  public.set_my_level(text, timestamptz) to authenticated;

alter publication supabase_realtime add table public.games, public.game_events;
