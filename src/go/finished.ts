/**
 * A finished game as the phone keeps it and the family's server stores it: the game itself, so it
 * can be replayed and scored again, and what the app knows about it, such as who played and the
 * rating it moved.
 *
 * The format is a promise. A record is read by every later app version, on the phone and on the
 * server, so:
 *
 * - `format`, `id`, `startedAt` and `endedAt` keep their meaning in every format, so any app can
 *   list, sort and tell apart a record it cannot read. A time is always UTC to the millisecond, as
 *   `toISOString` writes it (`2026-10-22T09:00:00.000Z`), so equal times are equal strings and
 *   sorting the strings sorts the times. `startedAt` is the first action of play (a move, a pass or
 *   a resignation), `endedAt` the moment the result was known: the phone's clock offline, the
 *   server's for an online game.
 * - `core` is what replays and scores the game: the rules version, the board, komi, the stones on
 *   the board before the first move, who moves first, the moves, the dead stones and the result.
 *   Its fields never change meaning. Each record has one spelling: point lists other than the moves
 *   are in ascending order, the setup is exactly the handicap stones on their points
 *   (`handicapPoints`, two or more of them, with White first), and numbers are written as
 *   `JSON.stringify` writes them (the server refuses `2.0` or `7.50`). A new field that changes how
 *   a game replays needs a new `format`; a new rules version needs a new `core.rules` (and
 *   `RULES_VERSION` in `rules.ts`). A game may be as long as it is played.
 * - `meta` describes the game for the player: who they are (`player`, their account id when the
 *   phone was signed in; a game played signed out has none until it is claimed), the mode, their
 *   colour, the handicap, and either the rating it moved, in whole numbers, or why it moved none:
 *   the Coach was on (`coached`), or, against the bot, the owner took a move back (`tookBack`). Later versions may add optional fields anywhere; readers
 *   ignore what they do not know, and keep it when they write the record again (`keepUnknown`).
 * - A reader that meets a format or a rules version newer than it knows keeps the record as it is
 *   and asks for an update (`NewerRecord`), instead of replaying a different game.
 * - The server checks records with `valid_game_record` (the baseline migration `20261024120000_go`,
 *   `20261025160000_game_record_coached`, which learned `coached`, and
 *   `20261025220000_game_record_took_back`, which learned `tookBack`).
 *   It accepts exactly the format-1 records `readFinished` reads, under any rules version, except
 *   that it also refuses fields it does not know: the server learns a format, and any field added
 *   to one, before an app writes it. The golden records in `__tests__/records/` are read by both,
 *   and each format adds its own.
 * - Every record `finishedGame` writes reads back and replays to its result. See docs/releasing.md.
 */
import {
  acceptScore,
  BLACK,
  Color,
  EMPTY,
  GameState,
  handicapPoints,
  maxHandicap,
  newGame,
  pass,
  play,
  resign,
  resumePlay,
  RULES_VERSION,
  setDead,
  situationKey,
  Stone,
  WHITE,
} from './rules';
import { encodeMoves, PASS } from './saved';

export const RECORD_FORMAT = 1;

export type GameMode = 'bot' | 'face_to_face' | 'online';

/** What replays and scores a game. Never changes meaning: see the top of this file. */
export interface GameCore {
  /** The rules version the game was played under (`RULES_VERSION`). */
  rules: number;
  size: number;
  komi: number;
  /** The stones on the board before the first move, handicap stones written out. */
  setup: { black: number[]; white: number[] };
  first: Color;
  /** Each move a point index (row × size + column), or `PASS`. A resignation is the result, not a move. */
  moves: number[];
  /** The stones taken off as dead before the count; none after a resignation. */
  dead: number[];
  /** `margin` is the points between the scores, and null after a resignation. */
  result: { winner: Color; reason: 'score' | 'resign'; margin: number | null };
}

/** What the app knows about a game beyond replaying it. Fields may be added; none is needed to replay. */
export interface GameMeta {
  /** The phone owner's account id; absent for a game played signed out. Always there online. */
  player?: string;
  mode: GameMode;
  /** Online games only, and always there: the game on the server, and the other player's account id. */
  onlineGame?: string;
  opponent?: string;
  /** The phone owner's colour; null face to face, where the owner may not be one of the players. */
  you: Color | null;
  /** As chosen when the game was set up; the stones themselves are in `core.setup`. */
  handicap: number;
  /** When the game moved the owner's rating; whole numbers. */
  rating?: { before: number; after: number; opponent: number };
  /** The Coach was on during one of the owner's turns, so the game moved no rating. */
  coached?: true;
  /** Against the bot, the owner took a move back, so the game moved no rating. */
  tookBack?: true;
}

export interface FinishedGame {
  format: typeof RECORD_FORMAT;
  /** Made on the phone (a UUID); the same game sent twice is stored once. */
  id: string;
  /** UTC to the millisecond: the first action of play, and when the result was known. See the top of this file. */
  startedAt: string;
  endedAt: string;
  core: GameCore;
  meta: GameMeta;
}

/** A record written by a newer app: kept as it is, listed by its date, and not replayed. */
export interface NewerRecord {
  newer: Record<string, unknown>;
  id: string;
  endedAt: string;
}

export const isNewer = (g: FinishedGame | NewerRecord): g is NewerRecord => 'newer' in g;

export interface FinishedContext {
  id: string;
  mode: GameMode;
  /** The rules version the game was played under: `RULES_VERSION`, or an online game's own. */
  rules: number;
  startedAt: string | null;
  endedAt: string;
  /** The account the phone is signed in to, if any. */
  player?: string | null;
  you: Color | null;
  onlineGame?: string;
  opponent?: string | null;
  rating?: GameMeta['rating'];
  coached?: boolean;
  tookBack?: boolean;
}

/** The record of a game that is over, or null while it is still on. */
export function finishedGame(game: GameState, ctx: FinishedContext): FinishedGame | null {
  const result = game.result;
  if (game.phase !== 'over' || !result) return null;
  // Every game starts as `newGame` sets it up: with two or more handicap stones White moves first.
  const handicap = game.handicap ?? 0;
  const stones = handicapSetup(game.size, handicap);
  const endedAt = utc(ctx.endedAt);
  const startedAt = utc(ctx.startedAt ?? ctx.endedAt);
  const rating = ctx.rating;
  return {
    format: RECORD_FORMAT,
    id: ctx.id,
    // The phone's clock may have been set back during the game; a record never ends before it starts.
    startedAt: startedAt <= endedAt ? startedAt : endedAt,
    endedAt,
    core: {
      rules: ctx.rules,
      size: game.size,
      komi: game.komi,
      setup: { black: stones, white: [] },
      first: stones.length ? 'white' : 'black',
      moves: encodeMoves(game.moves),
      dead: result.reason === 'score' ? [...game.dead].sort((a, b) => a - b) : [],
      result: {
        winner: result.winner,
        reason: result.reason === 'score' ? 'score' : 'resign',
        margin: result.reason === 'score' ? result.margin : null,
      },
    },
    meta: {
      ...(ctx.player ? { player: ctx.player } : {}),
      mode: ctx.mode,
      ...(ctx.onlineGame ? { onlineGame: ctx.onlineGame } : {}),
      ...(ctx.opponent ? { opponent: ctx.opponent } : {}),
      you: ctx.you,
      handicap,
      ...(rating
        ? { rating: { before: Math.round(rating.before), after: Math.round(rating.after), opponent: Math.round(rating.opponent) } }
        : {}),
      ...(ctx.coached ? { coached: true as const } : {}),
      ...(ctx.tookBack ? { tookBack: true as const } : {}),
    },
  };
}

/** Rules versions a record may name, from this app's to far beyond any there will be: bounded so both sides read the same number. */
const MAX_RULES = 1000;

const COLORS: readonly unknown[] = ['black', 'white'];
const MODES: readonly unknown[] = ['bot', 'face_to_face', 'online'];
/** Ids are written in lower case, as the server writes its own, so the same id is the same string. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isId = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);
/** Far beyond any rating, so a later rating scale still reads; it keeps the numbers ones both sides store alike. */
const RATING_LIMIT = 100000;
type JsonObject = Record<string, unknown>;
const isObject = (x: unknown): x is JsonObject => typeof x === 'object' && x !== null && !Array.isArray(x);
/**
 * A time as ISO 8601 with a zone, as `toISOString` and the server write them, in milliseconds; null
 * for anything else. Parsed by hand: Hermes's `Date.parse` does not read the server's microseconds.
 * `valid_game_record` on the server accepts the same strings.
 */
export function instant(x: unknown): number | null {
  const m =
    typeof x === 'string' &&
    /^([12]\d{3})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,6})?(Z|([+-])(0\d|1[0-4]):([0-5]\d))$/.exec(x);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (mo < 1 || mo > 12 || d < 1 || d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]) return null;
  const offset = m[8] === 'Z' ? 0 : (m[9] === '-' ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11]));
  // Microseconds kept, so the phone orders two times as the server does.
  return Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6])) + Number(m[7] ?? 0) * 1000 - offset * 60000;
}
/** A time as `toISOString` writes it, the one spelling a record uses (UTC, milliseconds); the server checks the same. */
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isTime = (x: unknown): x is string => typeof x === 'string' && UTC.test(x) && instant(x) !== null;
/** A time from the phone or the server written the record's way; a time `instant` cannot read stays as it is, and the record is refused. */
function utc(x: string): string {
  const t = instant(x);
  if (t === null) return x;
  const ms = Math.floor(t);
  const days = Math.floor(ms / 86400000);
  const inDay = ms - days * 86400000;
  // Days since 1970 to a date, after Howard Hinnant's `civil_from_days` (no `Date` in the rules).
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const [h, mi, sec, milli] = [Math.floor(inDay / 3600000), Math.floor(inDay / 60000) % 60, Math.floor(inDay / 1000) % 60, inDay % 1000];
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(sec)}.${pad(milli, 3)}Z`;
}
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** A number ending in .5, as komi and every score margin do: komi rules out a draw. */
const isHalf = (x: unknown): x is number => isNumber(x) && Number.isInteger(x * 2) && !Number.isInteger(x);
const isRating = (x: unknown) => Number.isInteger(x) && Math.abs(x as number) <= RATING_LIMIT;
const isPoints = (x: unknown, min: number, size: number): x is number[] =>
  Array.isArray(x) && x.every((p) => Number.isInteger(p) && p >= min && p < size * size);
/** Points on the board in ascending order, each once: the one spelling of a set of points. */
const isPointSet = (x: unknown, size: number): x is number[] => isPoints(x, 0, size) && x.every((p, i) => i === 0 || x[i - 1] < p);
/** The setup a game with `handicap` stones starts from, in the record's order. One stone is no stone: Black moves first with less komi. */
const handicapSetup = (size: number, handicap: number) => (handicap > 1 ? handicapPoints(size, handicap).sort((a, b) => a - b) : []);

function validCore(c: unknown): c is GameCore {
  if (!isObject(c) || !Number.isInteger(c.rules) || (c.rules as number) < RULES_VERSION || (c.rules as number) > MAX_RULES) return false;
  if (![9, 13, 19].includes(c.size as number)) return false;
  const size = c.size as number;
  const { setup, result } = c;
  return (
    isHalf(c.komi) &&
    Math.abs(c.komi) < size * size &&
    isObject(setup) &&
    isPointSet(setup.black, size) &&
    // Every game starts as `newGame` sets it up: Black's handicap stones, if any, and then White moves first.
    Array.isArray(setup.white) &&
    setup.white.length === 0 &&
    c.first === (setup.black.length ? 'white' : 'black') &&
    isPoints(c.moves, PASS, size) &&
    isPointSet(c.dead, size) &&
    isObject(result) &&
    COLORS.includes(result.winner) &&
    // Areas and komi bound the margin: no side has more than the board.
    ((result.reason === 'score' && isHalf(result.margin) && result.margin > 0 && result.margin <= size * size + Math.abs(c.komi)) ||
      (result.reason === 'resign' && result.margin === null && c.dead.length === 0))
  );
}

function validMeta(m: unknown, core: GameCore): m is GameMeta {
  if (!isObject(m) || !MODES.includes(m.mode)) return false;
  const r = m.rating;
  const online = m.mode === 'online';
  const handicap = m.handicap;
  return (
    (online ? isId(m.player) : m.player === undefined || isId(m.player)) &&
    (online ? isId(m.onlineGame) && isId(m.opponent) && m.opponent !== m.player : m.onlineGame === undefined && m.opponent === undefined) &&
    (m.mode === 'face_to_face' ? m.you === null : COLORS.includes(m.you)) &&
    Number.isInteger(handicap) &&
    (handicap as number) >= 0 &&
    (handicap as number) <= maxHandicap(core.size) &&
    handicapSetup(core.size, handicap as number).join() === core.setup.black.join() &&
    (r === undefined || (isObject(r) && isRating(r.before) && isRating(r.after) && isRating(r.opponent))) &&
    (m.coached === undefined || (m.coached === true && r === undefined)) &&
    (m.tookBack === undefined || (m.tookBack === true && r === undefined && m.mode === 'bot'))
  );
}

/**
 * A record read back from the phone or the server: the game; a `NewerRecord` when a newer app
 * wrote it in a format this one does not know, or a format-1 record under rules it does not know;
 * or null when it is not a record. Fields this app does not know are kept on the returned game.
 */
export function readFinished(x: unknown): FinishedGame | NewerRecord | null {
  if (!isObject(x) || !Number.isInteger(x.format) || (x.format as number) < 1) return null;
  if (!isId(x.id) || !isTime(x.startedAt) || !isTime(x.endedAt)) return null;
  if (instant(x.startedAt)! > instant(x.endedAt)!) return null;
  const newer = { newer: x, id: x.id, endedAt: x.endedAt };
  if (x.format !== RECORD_FORMAT) return newer;
  // The format fixes the shape whatever the rules; only replaying needs to know them.
  if (!isFinished(x)) return null;
  return x.core.rules === RULES_VERSION ? x : newer;
}

const isFinished = (x: JsonObject): x is JsonObject & FinishedGame => validCore(x.core) && validMeta(x.meta, x.core);

/** The online game a kept record is of, if any. */
export const onlineGameOf = (g: FinishedGame | NewerRecord): string | undefined => (isNewer(g) ? undefined : g.meta.onlineGame);

/** True when two records of one game end the same way: the same result and the same dead stones. */
export const sameResult = (a: FinishedGame, b: FinishedGame) =>
  a.core.result.winner === b.core.result.winner &&
  a.core.result.reason === b.core.result.reason &&
  a.core.result.margin === b.core.result.margin &&
  a.core.dead.join() === b.core.dead.join();

export type Replay = { ok: true; game: GameState } | { ok: false; problem: string };

/**
 * Plays a record through the rules from its own setup, and checks that it ends with the result it
 * stores. Play may stop at two passes and go on again, as when players resume to settle a group.
 */
export function replayFinished(f: FinishedGame): Replay {
  const { core } = f;
  if (core.rules !== RULES_VERSION) return { ok: false, problem: `rules ${core.rules} unknown` };
  const board: Stone[] = new Array<Stone>(core.size * core.size).fill(EMPTY);
  for (const p of core.setup.black) board[p] = BLACK;
  for (const p of core.setup.white) board[p] = WHITE;
  let g: GameState = {
    ...newGame(core.size, core.komi, 0),
    board,
    toPlay: core.first,
    seen: new Set([situationKey(board, core.first)]),
  };
  for (const [i, m] of core.moves.entries()) {
    if (g.phase === 'scoring') g = resumePlay(g);
    if (m === PASS) g = pass(g);
    else {
      const r = play(g, m);
      if (!r.ok) return { ok: false, problem: `move ${i + 1} refused: ${r.reason}` };
      g = r.state;
    }
  }
  const { result } = core;
  if (result.reason === 'resign') g = resign(g, result.winner === 'black' ? 'white' : 'black');
  else {
    if (g.phase !== 'scoring') return { ok: false, problem: 'scored before two passes' };
    if (core.dead.some((p) => g.board[p] === EMPTY)) return { ok: false, problem: 'a dead stone on an empty point' };
    g = acceptScore(setDead(g, core.dead));
    const r = g.result!;
    if (r.winner !== result.winner || (r.reason === 'score' && r.margin !== result.margin)) {
      return { ok: false, problem: `replays as ${r.winner} by ${r.reason === 'score' ? r.margin : '?'}` };
    }
  }
  return { ok: true, game: g };
}

/** The fields this app knows, by their path in a record; anything else is kept as a newer app wrote it. */
const KNOWN: Record<string, readonly string[]> = {
  record: ['format', 'id', 'startedAt', 'endedAt', 'core', 'meta'],
  core: ['rules', 'size', 'komi', 'setup', 'first', 'moves', 'dead', 'result'],
  'core.setup': ['black', 'white'],
  'core.result': ['winner', 'reason', 'margin'],
  meta: ['player', 'mode', 'onlineGame', 'opponent', 'you', 'handicap', 'rating', 'coached', 'tookBack'],
  'meta.rating': ['before', 'after', 'opponent'],
};

function withUnknownFrom<T extends object>(old: T, next: T, path: string): T {
  const known = KNOWN[path] ?? [];
  const out = Object.assign({}, next) as JsonObject;
  for (const [k, v] of Object.entries(old)) {
    const sub = path === 'record' ? k : `${path}.${k}`;
    const theirs = out[k];
    if (!known.includes(k)) {
      if (!(k in out)) out[k] = v;
    } else if (KNOWN[sub] && isObject(v) && isObject(theirs)) out[k] = withUnknownFrom(v, theirs, sub);
  }
  return out as T;
}

/** A record written again, e.g. after a recount, keeps what a newer app added to the old one. */
export const keepUnknown = (old: FinishedGame, next: FinishedGame): FinishedGame => withUnknownFrom(old, next, 'record');
