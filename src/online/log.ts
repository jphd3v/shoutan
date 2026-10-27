/**
 * An online game is a numbered list of events that both phones replay with the
 * shared rules. Go has no hidden information, so each phone can check everything
 * the other sends:
 *
 * - Every event is parsed strictly and replayed with the rules.
 * - Every event carries `prev`, the hash of the event before it, and `hash`, which
 *   covers `prev`, the event and the full game state after it. The first `prev` is
 *   derived from the game id, board size, komi and rules version. A phone that sees
 *   a different hash than it computes has found tampering, a rules bug or a version
 *   mismatch, at that exact event.
 *
 * The database enforces seats, turn order, the phase machine and that each event
 * extends the current chain head; see the online play migrations.
 */
import { estimateDead } from '../go/ai';
import {
  acceptScore,
  Color,
  GameState,
  IllegalReason,
  newGame,
  pass,
  play,
  resign,
  Result,
  resumePlay,
  RULES_VERSION,
  setDead,
  toggleDead,
} from '../go/rules';
import { deadEstimatePlayouts } from '../go/session';
import { sha256 } from './sha256';

/** Every online game is created at `RULES_VERSION` (`src/go/rules.ts`); a higher one is a newer app's. */
export { RULES_VERSION };

/** A move or scoring action, before it is sealed into the chain. */
export type GameEvent =
  | { kind: 'play'; color: Color; point: number }
  /** The pass that starts scoring carries the suggested dead stones, so both phones mark the same ones. */
  | { kind: 'pass'; color: Color; dead?: number[] }
  | { kind: 'resign'; color: Color }
  | { kind: 'mark'; color: Color; point: number }
  | { kind: 'accept'; color: Color }
  | { kind: 'resume'; color: Color };

export type SealedEvent = GameEvent & { prev: string; hash: string };

export type RefusedReason =
  IllegalReason | 'notYourTurn' | 'notScoring' | 'gameOver' | 'alreadyAccepted' | 'badDeadList' | 'brokenChain' | 'hashMismatch';

export interface GameMeta {
  id: string;
  size: number;
  komi: number;
  rulesVersion: number;
  /** Black's handicap stones (0 for none). */
  handicap: number;
}

export interface OnlineGame {
  meta: GameMeta;
  game: GameState;
  events: readonly SealedEvent[];
  /** Who has accepted the current dead-stone marks. Play ends when both have. */
  accepted: { black: boolean; white: boolean };
  /** Hash of the last event, or the genesis hash before the first one. */
  head: string;
}

export type ApplyResult = { ok: true; state: OnlineGame } | { ok: false; reason: RefusedReason };

const nobody = { black: false, white: false };

/** Must match genesis_hash() in the database. */
export const genesis = (m: GameMeta) =>
  sha256(`go-online|rules ${m.rulesVersion}|${m.id}|${m.size}|${m.komi}|handicap ${m.handicap}|chinese`);

/** The starting position; the komi stored with the game is the one both phones use. */
const startingGame = (m: GameMeta): GameState => ({ ...newGame(m.size, undefined, m.handicap), komi: m.komi });

export const startOnline = (meta: GameMeta): OnlineGame => ({
  meta,
  game: startingGame(meta),
  events: [],
  accepted: nobody,
  head: genesis(meta),
});

/** The event fields that change the game, in a fixed order. */
function canonicalEvent(ev: GameEvent): string {
  const point = 'point' in ev ? ev.point : '';
  const dead = ev.kind === 'pass' && ev.dead ? ev.dead.join(',') : '-';
  return `${ev.kind}:${ev.color}:${point}:${dead}`;
}

/** Everything that defines the position and what may happen next. */
function stateDigest(g: GameState, accepted: OnlineGame['accepted']): string {
  const r = g.result;
  const result = !r ? '-' : r.reason === 'score' ? `score:${r.winner}:${r.black}:${r.white}` : `resign:${r.winner}`;
  return [
    g.board.join(''),
    g.toPlay,
    g.phase,
    g.captures.black,
    g.captures.white,
    g.consecutivePasses,
    [...g.dead].sort((a, b) => a - b).join(','),
    accepted.black ? 1 : 0,
    accepted.white ? 1 : 0,
    result,
  ].join('|');
}

const chainHash = (prev: string, ev: GameEvent, g: GameState, accepted: OnlineGame['accepted']) =>
  sha256(`${prev}\n${canonicalEvent(ev)}\n${stateDigest(g, accepted)}`);

/** Applies the rules to an event, without looking at its hashes. */
function rulesApply(
  s: OnlineGame,
  ev: GameEvent,
): { ok: true; game: GameState; accepted: OnlineGame['accepted'] } | { ok: false; reason: RefusedReason } {
  const { game } = s;
  if (game.phase === 'over') return { ok: false, reason: 'gameOver' };
  switch (ev.kind) {
    case 'resign':
      return { ok: true, game: resign(game, ev.color), accepted: s.accepted };
    case 'play': {
      if (game.phase !== 'playing') return { ok: false, reason: 'notPlaying' };
      if (game.toPlay !== ev.color) return { ok: false, reason: 'notYourTurn' };
      const r = play(game, ev.point);
      return r.ok ? { ok: true, game: r.state, accepted: s.accepted } : { ok: false, reason: r.reason };
    }
    case 'pass': {
      if (game.phase !== 'playing') return { ok: false, reason: 'notPlaying' };
      if (game.toPlay !== ev.color) return { ok: false, reason: 'notYourTurn' };
      const g = pass(game);
      // A dead list belongs exactly to the pass that starts scoring, and names only stones.
      if ((g.phase === 'scoring') !== (ev.dead !== undefined)) return { ok: false, reason: 'badDeadList' };
      if (ev.dead && ev.dead.some((p, i) => g.board[p] === undefined || g.board[p] === 0 || (i > 0 && p <= ev.dead![i - 1]))) {
        return { ok: false, reason: 'badDeadList' };
      }
      return { ok: true, game: g.phase === 'scoring' ? setDead(g, ev.dead ?? []) : g, accepted: nobody };
    }
    case 'mark':
      if (game.phase !== 'scoring') return { ok: false, reason: 'notScoring' };
      if (game.board[ev.point] === undefined) return { ok: false, reason: 'outOfBounds' };
      return { ok: true, game: toggleDead(game, ev.point), accepted: nobody };
    case 'accept': {
      if (game.phase !== 'scoring') return { ok: false, reason: 'notScoring' };
      if (s.accepted[ev.color]) return { ok: false, reason: 'alreadyAccepted' };
      const accepted = { ...s.accepted, [ev.color]: true };
      return { ok: true, game: accepted.black && accepted.white ? acceptScore(game) : game, accepted };
    }
    case 'resume':
      if (game.phase !== 'scoring') return { ok: false, reason: 'notScoring' };
      return { ok: true, game: resumePlay(game), accepted: nobody };
  }
}

/** Checks a received event against the chain and the rules, and applies it. */
export function applyEvent(s: OnlineGame, ev: SealedEvent): ApplyResult {
  if (ev.prev !== s.head) return { ok: false, reason: 'brokenChain' };
  const r = rulesApply(s, ev);
  if (!r.ok) return r;
  const hash = chainHash(s.head, ev, r.game, r.accepted);
  if (hash !== ev.hash) return { ok: false, reason: 'hashMismatch' };
  return { ok: true, state: { meta: s.meta, game: r.game, events: [...s.events, ev], accepted: r.accepted, head: hash } };
}

export type SealResult = { ok: true; event: SealedEvent; state: OnlineGame } | { ok: false; reason: RefusedReason };

/**
 * Turns an action made on this phone into a sealed event. The pass that starts
 * scoring carries the dead-stone suggestion: the `dead` the caller worked out ahead,
 * or the guess made here.
 */
export function seal(s: OnlineGame, action: GameEvent): SealResult {
  let ev: GameEvent = action;
  if (ev.kind === 'pass') {
    // The dead list is the sender's suggestion. The other phone checks only that it names stones,
    // and both players see the marks and must accept them before the game is counted.
    ev = { kind: 'pass', color: ev.color };
    if (s.game.phase === 'playing' && s.game.consecutivePasses >= 1 && s.game.toPlay === ev.color) {
      const scoring = pass(s.game);
      const dead =
        action.kind === 'pass' && action.dead ? action.dead : estimateDead(scoring, { playouts: deadEstimatePlayouts(scoring.size) });
      ev = { ...ev, dead };
    }
  }
  const r = rulesApply(s, ev);
  if (!r.ok) return r;
  const hash = chainHash(s.head, ev, r.game, r.accepted);
  const event: SealedEvent = { ...ev, prev: s.head, hash };
  return { ok: true, event, state: { meta: s.meta, game: r.game, events: [...s.events, event], accepted: r.accepted, head: hash } };
}

export type ReplayResult = { ok: true; state: OnlineGame } | { ok: false; index: number; reason: RefusedReason; state: OnlineGame };

/** Applies events in order. On a refusal, `state` is the game as of the last valid event. */
export function extend(state: OnlineGame, events: readonly SealedEvent[]): ReplayResult {
  for (let i = 0; i < events.length; i++) {
    const r = applyEvent(state, events[i]);
    if (!r.ok) return { ok: false, index: state.events.length, reason: r.reason, state };
    state = r.state;
  }
  return { ok: true, state };
}

export const replay = (meta: GameMeta, events: readonly SealedEvent[]) => extend(startOnline(meta), events);

const HEX64 = /^[0-9a-f]{64}$/;
const COLORS: readonly unknown[] = ['black', 'white'];
const isPoint = (v: unknown, size: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < size * size;

/**
 * Validates an event read from the database: only known kinds, only the fields that
 * kind has, points on the board. Anything else is treated like a rules violation.
 */
export function parseEvent(raw: unknown, size: number): SealedEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!COLORS.includes(o.color) || typeof o.prev !== 'string' || !HEX64.test(o.prev) || typeof o.hash !== 'string' || !HEX64.test(o.hash)) {
    return null;
  }
  const color = o.color as Color;
  const base = { prev: o.prev, hash: o.hash };
  const keys = Object.keys(o).sort().join(',');
  switch (o.kind) {
    case 'play':
    case 'mark':
      if (keys !== 'color,hash,kind,point,prev' || !isPoint(o.point, size)) return null;
      return { kind: o.kind, color, point: o.point as number, ...base };
    case 'pass':
      if (keys === 'color,hash,kind,prev') return { kind: 'pass', color, ...base };
      if (keys !== 'color,dead,hash,kind,prev' || !Array.isArray(o.dead) || !o.dead.every((p) => isPoint(p, size))) return null;
      return { kind: 'pass', color, dead: o.dead as number[], ...base };
    case 'resign':
    case 'accept':
    case 'resume':
      if (keys !== 'color,hash,kind,prev') return null;
      return { kind: o.kind, color, ...base };
    default:
      return null;
  }
}

export interface Summary {
  status: 'playing' | 'scoring' | 'over';
  toPlay: Color;
  result: Result | null;
}

/** What the database records about the game after an event. */
export const summary = (s: OnlineGame): Summary => ({
  status: s.game.phase,
  toPlay: s.game.toPlay,
  result: s.game.result ?? null,
});
