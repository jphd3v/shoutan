/**
 * What the Guide points out: the liberties of a group, what a move just did (taking a ko) and, for the player to move, the tactical reasons a move can have (capture,
 * escape, atari). Pure and cheap enough to run after every move on 19×19.
 */
import { openPoints } from './ai';
import { formedTerritory } from './count';
import { chainAt, Color, colorOf, EMPTY, GameState, isLegal, play, Stone, stoneOf } from './rules';

export interface Moment {
  kind: 'ko';
  /** The owner of the stone taken in the ko. */
  color: Color;
  /** Ascending points of those stones. */
  points: readonly number[];
  count: number;
}

export interface Suggestion {
  kind: 'capture' | 'escape' | 'atari';
  point: number;
  /** Stones captured, saved or threatened. */
  count: number;
}

const MAX_SUGGESTIONS = 2;

export function libertiesOf(state: GameState, p: number): number[] {
  return [...chainAt(state.board, state.size, p).liberties];
}

/** A liberty on the board: whose it is (`black`, `white`, or both) and, per colour, whether it is a group's only one. */
export interface Liberty {
  point: number;
  black: boolean;
  white: boolean;
  last: Record<Color, boolean>;
}

/**
 * Every liberty on the board, each point once, leaving out points inside territory one colour already
 * holds: there they would only crowd the territory's own marks, and a last one there is no warning worth giving.
 */
export function allLiberties(state: GameState): Liberty[] {
  const out = new Map<number, Liberty>();
  const held = new Set(formedTerritory(state).flatMap((r) => r.points));
  for (const c of chains(state.board, state.size)) {
    for (const l of c.liberties) {
      if (held.has(l)) continue;
      const d = out.get(l) ?? { point: l, black: false, white: false, last: { black: false, white: false } };
      d[c.color] = true;
      d.last[c.color] ||= c.liberties.size === 1;
      out.set(l, d);
    }
  }
  return [...out.values()];
}

/** Chains on the board, each listed once, with their liberties. */
function chains(board: GameState['board'], size: number) {
  const seen = new Set<number>();
  const out: { color: Color; stones: number[]; liberties: Set<number> }[] = [];
  for (let p = 0; p < board.length; p++) {
    if (board[p] === EMPTY || seen.has(p)) continue;
    const c = chainAt(board, size, p);
    for (const s of c.stones) seen.add(s);
    out.push({ color: colorOf(board[p]), stones: c.stones.sort((a, b) => a - b), liberties: c.liberties });
  }
  return out;
}

/** Each pair of same-coloured stones next to each other (along a line, not diagonally), for drawing groups as one shape. */
export function connections(board: readonly Stone[], size: number): { from: number; to: number; color: Color }[] {
  const out: { from: number; to: number; color: Color }[] = [];
  board.forEach((s, p) => {
    if (s === EMPTY) return;
    const color = colorOf(s);
    if (p % size < size - 1 && board[p + 1] === s) out.push({ from: p, to: p + 1, color });
    if (p + size < board.length && board[p + size] === s) out.push({ from: p, to: p + size, color });
  });
  return out;
}

/** What the last move did, most important first. Empty unless `after` is `before` plus one stone. */
export function momentsAfter(before: GameState, after: GameState): Moment[] {
  const move = after.moves[after.moves.length - 1];
  if (after.moves.length !== before.moves.length + 1 || move?.kind !== 'play' || before.size !== after.size) return [];
  // A game that only looks one move longer, such as another game opened in its place, is not a move.
  const replayed = play({ ...before, toPlay: move.color }, move.point);
  if (!replayed.ok || replayed.state.board.some((s, p) => s !== after.board[p])) return [];
  const out: Moment[] = [];
  const captured = before.board.flatMap((s, p) => (s !== EMPTY && after.board[p] === EMPTY ? [p] : []));
  // A plain capture gets no note: the stones leaving the board show it. A ko does: one stone taken by
  // a lone stone whose only liberty is the point just emptied could be taken straight back, which the
  // ko rule forbids for one move.
  const mover = chainAt(after.board, after.size, move.point);
  if (captured.length === 1 && mover.stones.length === 1 && mover.liberties.size === 1 && mover.liberties.has(captured[0])) {
    out.push({ kind: 'ko', color: colorOf(before.board[captured[0]]), points: captured, count: 1 });
  }
  // Atari, either player's, gets no note: the board's liberties and the Coach's outlines show it.
  return out;
}

/** Up to two tactical options for the player to move: escape from atari, capture, then atari. */
export function suggestionsFor(state: GameState): Suggestion[] {
  if (state.phase !== 'playing') return [];
  const me = state.toPlay;
  const found: Suggestion[] = [];
  const add = (kind: Suggestion['kind'], point: number, count: number) => {
    const same = found.find((s) => s.kind === kind && s.point === point);
    if (same) same.count += count;
    else found.push({ kind, point, count });
  };
  // A move is worth showing if it is legal and the stone played does not end up in atari itself.
  const safe = (p: number) => {
    if (!isLegal(state, p)) return null;
    const r = play(state, p);
    return r.ok && chainAt(r.state.board, state.size, p).liberties.size >= 2 ? r.state : null;
  };

  for (const c of chains(state.board, state.size)) {
    const libs = [...c.liberties];
    if (c.color !== me && libs.length === 1 && isLegal(state, libs[0])) add('capture', libs[0], c.stones.length);
    if (c.color === me && libs.length === 1 && safe(libs[0])) add('escape', libs[0], c.stones.length);
    if (c.color !== me && libs.length === 2) {
      for (const l of libs) {
        const after = safe(l);
        if (after && after.board[c.stones[0]] === stoneOf(c.color) && chainAt(after.board, state.size, c.stones[0]).liberties.size === 1) {
          add('atari', l, c.stones.length);
        }
      }
    }
  }

  // Losing your own stones hurts most, so saving them comes first.
  const rank = { escape: 0, capture: 1, atari: 2 };
  const out: Suggestion[] = [];
  for (const s of found.sort((a, b) => rank[a.kind] - rank[b.kind] || b.count - a.count)) {
    if (out.length < MAX_SUGGESTIONS && !out.some((o) => o.point === s.point)) out.push(s);
  }
  return out;
}

/**
 * Whether passing now would leave much of the board unsettled: more than an eighth of it still
 * open to either player. Finished games almost never leave that much; beginners often pass that
 * early, and then the count has to guess.
 */
export function passIsEarly(state: GameState): boolean {
  return state.phase === 'playing' && isEarly(state, openPoints(state, { playouts: passCheckPlayouts(state.size) }));
}

/** Few playouts, so the answer is ready soon after each move: the line it draws is coarse. */
export const passCheckPlayouts = (size: number) => (size <= 9 ? 100 : size <= 13 ? 60 : 40);

/** `passIsEarly` from the open points a search of `passCheckPlayouts` found. */
export const isEarly = (state: GameState, open: number) => open * 8 > state.board.length;
