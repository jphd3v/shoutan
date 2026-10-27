/**
 * Go under the Chinese rules (Chinese Weiqi Association, 2002): captures, suicide is illegal
 * (art. 5), a move may not make the opponent face a position that has occurred before (art. 6,
 * which also covers simple ko), two consecutive passes end play (art. 7), then dead stones are
 * marked and the game is scored by area: stones and the points they surround, with the points
 * between both sides' stones split half each (art. 9), and komi for White (art. 11).
 */

export type Color = 'black' | 'white';
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Stone = typeof EMPTY | typeof BLACK | typeof WHITE;

export const stoneOf = (c: Color): Stone => (c === 'black' ? BLACK : WHITE);
export const colorOf = (s: Stone): Color => (s === BLACK ? 'black' : 'white');
export const other = (c: Color): Color => (c === 'black' ? 'white' : 'black');

export type Move =
  { color: Color; kind: 'play'; point: number; captured: number } | { color: Color; kind: 'pass' } | { color: Color; kind: 'resign' };

export type Result =
  { winner: Color; reason: 'score'; margin: number; black: number; white: number } | { winner: Color; reason: 'resignation' };

export type Phase = 'playing' | 'scoring' | 'over';

/**
 * The rules a game is played under, by number: the Chinese rules (2002 text) with the Chinese
 * handicap of `newGame`. Online games and finished-game records both carry it, so an app meeting a
 * higher number knows a newer app made the game. Bump it when a rules change would replay a game
 * differently.
 */
export const RULES_VERSION = 4;

export interface GameState {
  size: number;
  komi: number;
  /** Black's stones placed before the first move; absent for an even game. */
  handicap?: number;
  board: readonly Stone[];
  toPlay: Color;
  /** Opponent stones captured by each colour. */
  captures: { black: number; white: number };
  /** Every position that has occurred, as `situationKey`, for superko. */
  seen: ReadonlySet<string>;
  consecutivePasses: number;
  moves: readonly Move[];
  phase: Phase;
  /** Stones marked dead during scoring. */
  dead: ReadonlySet<number>;
  /**
   * Stones whose suggested mark is only a guess: the position left their fate open. A group leaves
   * it once a player taps it. Shown to the players, never part of the score or an online event.
   */
  unsure?: ReadonlySet<number>;
  result?: Result;
}

export type IllegalReason = 'notPlaying' | 'outOfBounds' | 'occupied' | 'suicide' | 'ko';

export type PlayResult = { ok: true; state: GameState; captured: number[] } | { ok: false; reason: IllegalReason };

export const DEFAULT_KOMI = 7.5;
export const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRST';

/**
 * What superko compares. Under the Chinese rules a position is the board and the player who
 * faces it, as art. 6 forbids making the opponent face a position again.
 */
export const situationKey = (board: readonly Stone[], toPlay: Color) => `${toPlay === 'black' ? 'b' : 'w'}${board.join('')}`;

/**
 * The most handicap stones on a board: nine on 13×13 and 19×19, and five on 9×9, where the
 * star points run out. The Chinese rules set no limit; this follows common practice.
 */
export const maxHandicap = (size: number) => (size < 13 ? 5 : 9);

/**
 * Black's handicap stones on the star points, in the usual order: two opposite corners, the
 * third and fourth corners, then the centre for an odd count, and the sides from six stones.
 */
export function handicapPoints(size: number, stones: number): number[] {
  const edge = size < 13 ? 2 : 3;
  const [lo, mid, hi] = [edge, (size - 1) / 2, size - 1 - edge];
  const at = (row: number, col: number) => row * size + col;
  const corners = [at(lo, hi), at(hi, lo), at(hi, hi), at(lo, lo)];
  const sides = [at(mid, lo), at(mid, hi), at(lo, mid), at(hi, mid)];
  const centre = at(mid, mid);
  const odd = stones % 2 === 1 && stones > 4 ? [centre] : [];
  if (stones <= 4) return corners.slice(0, stones);
  return [...corners, ...sides.slice(0, stones - 4 - odd.length), ...odd];
}

/**
 * A new game under the Chinese rules. The rules text (2002) covers only even games, with 3¾ stones
 * of komi (7½ points); handicap games follow the Chinese custom of Black returning half a stone,
 * a point of the margin, for each handicap stone, plus ½ point so that no game is drawn. One stone
 * (让先) means Black plays first on an empty board with ½ komi; with more, Black's stones are on
 * the star points and White plays first.
 */
export function newGame(size = 9, komi?: number, handicap = 0): GameState {
  if (!Number.isInteger(size) || size < 2 || size > 19) throw new Error(`Unsupported size ${size}`);
  if (!Number.isInteger(handicap) || handicap < 0 || handicap > maxHandicap(size)) {
    throw new Error(`Handicap must be none or 1 to ${maxHandicap(size)} stones`);
  }
  if (handicap) komi = 0.5 + (handicap === 1 ? 0 : handicap);
  komi ??= DEFAULT_KOMI;
  // A half-point komi rules out drawn games.
  if (!Number.isInteger(komi * 2) || Number.isInteger(komi)) throw new Error(`Komi must end in .5`);
  const board: Stone[] = new Array(size * size).fill(EMPTY);
  for (const p of handicap > 1 ? handicapPoints(size, handicap) : []) board[p] = BLACK;
  const toPlay: Color = handicap > 1 ? 'white' : 'black';
  return {
    size,
    komi,
    ...(handicap ? { handicap } : {}),
    board,
    toPlay,
    captures: { black: 0, white: 0 },
    seen: new Set([situationKey(board, toPlay)]),
    consecutivePasses: 0,
    moves: [],
    phase: 'playing',
    dead: new Set(),
  };
}

/** Human-readable coordinate, e.g. "D4" (columns skip I, rows count from the bottom). */
export function pointName(size: number, point: number): string {
  const r = Math.floor(point / size);
  const c = point % size;
  return `${COLUMN_LETTERS[c]}${size - r}`;
}

export function pointFromName(size: number, name: string): number {
  const c = COLUMN_LETTERS.indexOf(name[0].toUpperCase());
  const row = Number(name.slice(1));
  if (c < 0 || c >= size || !Number.isInteger(row) || row < 1 || row > size) {
    throw new Error(`Bad point name ${name}`);
  }
  return (size - row) * size + c;
}

export function neighbors(size: number, p: number): number[] {
  const r = Math.floor(p / size);
  const c = p % size;
  const out: number[] = [];
  if (r > 0) out.push(p - size);
  if (r < size - 1) out.push(p + size);
  if (c > 0) out.push(p - 1);
  if (c < size - 1) out.push(p + 1);
  return out;
}

/** The chain containing `p` and its liberties. */
export function chainAt(board: readonly Stone[], size: number, p: number): { stones: number[]; liberties: Set<number> } {
  const color = board[p];
  const stones: number[] = [];
  const liberties = new Set<number>();
  if (color === EMPTY) return { stones, liberties };
  const seen = new Set([p]);
  const stack = [p];
  while (stack.length) {
    const q = stack.pop()!;
    stones.push(q);
    for (const n of neighbors(size, q)) {
      if (board[n] === EMPTY) liberties.add(n);
      else if (board[n] === color && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return { stones, liberties };
}

export function play(state: GameState, point: number): PlayResult {
  if (state.phase !== 'playing') return { ok: false, reason: 'notPlaying' };
  const { size } = state;
  if (!Number.isInteger(point) || point < 0 || point >= size * size) {
    return { ok: false, reason: 'outOfBounds' };
  }
  if (state.board[point] !== EMPTY) return { ok: false, reason: 'occupied' };

  const me = stoneOf(state.toPlay);
  const them = stoneOf(other(state.toPlay));
  const board = state.board.slice();
  board[point] = me;

  const captured: number[] = [];
  for (const n of neighbors(size, point)) {
    if (board[n] !== them) continue;
    const chain = chainAt(board, size, n);
    if (chain.liberties.size === 0) {
      for (const s of chain.stones) {
        board[s] = EMPTY;
        captured.push(s);
      }
    }
  }
  if (chainAt(board, size, point).liberties.size === 0) return { ok: false, reason: 'suicide' };

  const k = situationKey(board, other(state.toPlay));
  if (state.seen.has(k)) return { ok: false, reason: 'ko' };
  const seen = new Set(state.seen);
  seen.add(k);

  const captures = { ...state.captures };
  captures[state.toPlay] += captured.length;
  return {
    ok: true,
    captured,
    state: {
      ...state,
      board,
      toPlay: other(state.toPlay),
      captures,
      seen,
      consecutivePasses: 0,
      moves: [...state.moves, { color: state.toPlay, kind: 'play', point, captured: captured.length }],
    },
  };
}

export function isLegal(state: GameState, point: number): boolean {
  return play(state, point).ok;
}

export function legalPoints(state: GameState): number[] {
  const out: number[] = [];
  for (let p = 0; p < state.board.length; p++) if (state.board[p] === EMPTY && isLegal(state, p)) out.push(p);
  return out;
}

export function pass(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  const consecutivePasses = state.consecutivePasses + 1;
  const seen = new Set(state.seen).add(situationKey(state.board, other(state.toPlay)));
  return {
    ...state,
    seen,
    toPlay: other(state.toPlay),
    consecutivePasses,
    moves: [...state.moves, { color: state.toPlay, kind: 'pass' }],
    phase: consecutivePasses >= 2 ? 'scoring' : 'playing',
  };
}

export function resign(state: GameState, color: Color): GameState {
  if (state.phase === 'over') return state;
  return {
    ...state,
    phase: 'over',
    moves: [...state.moves, { color, kind: 'resign' }],
    result: { winner: other(color), reason: 'resignation' },
  };
}

/** Marks or unmarks the whole chain at `point` as dead. */
export function toggleDead(state: GameState, point: number): GameState {
  if (state.phase !== 'scoring' || state.board[point] === EMPTY) return state;
  const { stones } = chainAt(state.board, state.size, point);
  const dead = new Set(state.dead);
  const makeDead = !dead.has(point);
  for (const s of stones) {
    if (makeDead) dead.add(s);
    else dead.delete(s);
  }
  if (!state.unsure?.has(point)) return { ...state, dead };
  const unsure = new Set(state.unsure);
  for (const s of stones) unsure.delete(s);
  return { ...state, dead, unsure };
}

export function setDead(state: GameState, points: Iterable<number>, unsure: Iterable<number> = []): GameState {
  if (state.phase !== 'scoring') return state;
  const onBoard = (ps: Iterable<number>) => new Set([...ps].filter((p) => state.board[p] !== EMPTY));
  const guessed = onBoard(unsure);
  return { ...state, dead: onBoard(points), unsure: guessed.size ? guessed : undefined };
}

/** Leaves the scoring phase so a disputed position can be played out. */
export function resumePlay(state: GameState): GameState {
  if (state.phase !== 'scoring') return state;
  return { ...state, phase: 'playing', consecutivePasses: 0, dead: new Set(), unsure: undefined };
}

export interface Score {
  /** Includes half the shared points. */
  black: number;
  /** Includes half the shared points, and komi. */
  white: number;
  /** Area owner of every point: BLACK, WHITE or EMPTY for neutral. */
  owner: Stone[];
  /** Empty points between both sides' stones, split half each. */
  shared: number;
}

/** Area score, treating stones in `state.dead` as removed. */
export function score(state: GameState): Score {
  const { size } = state;
  const board = state.board.map((s, i) => (state.dead.has(i) ? EMPTY : s));
  const owner: Stone[] = board.slice();
  const visited = new Set<number>();
  let shared = 0;
  for (let p = 0; p < board.length; p++) {
    if (board[p] !== EMPTY || visited.has(p)) continue;
    const region: number[] = [];
    const borders = new Set<Stone>();
    const stack = [p];
    visited.add(p);
    while (stack.length) {
      const q = stack.pop()!;
      region.push(q);
      for (const n of neighbors(size, q)) {
        if (board[n] === EMPTY) {
          if (!visited.has(n)) {
            visited.add(n);
            stack.push(n);
          }
        } else borders.add(board[n]);
      }
    }
    const regionOwner = borders.size === 1 ? [...borders][0] : EMPTY;
    for (const q of region) owner[q] = regionOwner;
    if (borders.size === 2) shared += region.length;
  }
  let black = shared / 2;
  let white = state.komi + shared / 2;
  for (const o of owner) {
    if (o === BLACK) black++;
    else if (o === WHITE) white++;
  }
  return { black, white, owner, shared };
}

export function acceptScore(state: GameState): GameState {
  if (state.phase !== 'scoring') return state;
  const { black, white } = score(state);
  const winner: Color = black > white ? 'black' : 'white';
  return {
    ...state,
    phase: 'over',
    result: { winner, reason: 'score', margin: Math.abs(black - white), black, white },
  };
}
