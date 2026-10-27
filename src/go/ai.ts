/**
 * Monte Carlo playouts: light random games to the end from a position. Their ownership map tells
 * how much of the board is still open (the early-pass check), projects the score, and suggests dead
 * stones where the bot's network doesn't (face to face and online). A root-level bandit (UCB with
 * all-moves-as-first statistics) spreads `Search`'s playouts over the first moves. All randomness
 * comes from a seeded generator, so a given position and seed always give the same answer.
 */
import { BLACK, chainAt, EMPTY, GameState, play, Stone, stoneOf, WHITE } from './rules';

export interface SearchOptions {
  playouts?: number;
  seed?: number;
}

export function defaultPlayouts(size: number): number {
  if (size <= 9) return 1200;
  if (size <= 13) return 500;
  return 200;
}

const BORDER = 3;

/** A small seeded generator (mulberry32): the same seed, the same numbers. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mutable padded board for fast playouts; simple ko only. Hot loops use
 * indexed typed arrays because iterator-based loops are much slower on Hermes.
 */
class FastBoard {
  readonly n: number;
  readonly w: number;
  readonly cells: Uint8Array;
  /** Padded index of each unpadded point. */
  readonly padOf: Int32Array;
  readonly dirs: Int32Array;
  private readonly diags: Int32Array;
  ko = -1;
  /** A liberty found by the most recent `libs` call. */
  lastLib = -1;
  private mark: Int32Array;
  private gen = 0;
  private stack: Int32Array;

  constructor(n: number) {
    this.n = n;
    const w = n + 2;
    this.w = w;
    this.cells = new Uint8Array(w * w).fill(BORDER);
    this.mark = new Int32Array(w * w);
    this.stack = new Int32Array(w * w);
    this.dirs = Int32Array.from([-w, w, -1, 1]);
    this.diags = Int32Array.from([-w - 1, -w + 1, w - 1, w + 1]);
    this.padOf = new Int32Array(n * n);
    for (let i = 0; i < n * n; i++) this.padOf[i] = (Math.floor(i / n) + 1) * w + (i % n) + 1;
  }

  static from(state: GameState): FastBoard {
    const b = new FastBoard(state.size);
    for (let i = 0; i < state.board.length; i++) b.cells[b.padOf[i]] = state.board[i];
    return b;
  }

  copyFrom(o: FastBoard) {
    this.cells.set(o.cells);
    this.ko = o.ko;
  }

  /** Liberties of the chain at p, counting at most max + 1. */
  libs(p: number, max: number): number {
    const { cells, mark, stack, dirs } = this;
    const color = cells[p];
    this.gen += 2;
    const stoneMark = this.gen;
    const libMark = this.gen + 1;
    let top = 0;
    let count = 0;
    stack[top++] = p;
    mark[p] = stoneMark;
    while (top) {
      const q = stack[--top];
      for (let k = 0; k < 4; k++) {
        const r = q + dirs[k];
        const c = cells[r];
        if (c === EMPTY) {
          if (mark[r] !== libMark) {
            mark[r] = libMark;
            this.lastLib = r;
            if (++count > max) return count;
          }
        } else if (c === color && mark[r] !== stoneMark) {
          mark[r] = stoneMark;
          stack[top++] = r;
        }
      }
    }
    return count;
  }

  private remove(p: number): number {
    const { cells, stack, dirs } = this;
    const color = cells[p];
    let top = 0;
    let removed = 0;
    stack[top++] = p;
    cells[p] = EMPTY;
    while (top) {
      const q = stack[--top];
      removed++;
      for (let k = 0; k < 4; k++) {
        const r = q + dirs[k];
        if (cells[r] === color) {
          cells[r] = EMPTY;
          stack[top++] = r;
        }
      }
    }
    return removed;
  }

  /** A point surrounded by one colour that the opponent cannot easily break. */
  isEye(p: number, color: number): boolean {
    const { cells, dirs, diags } = this;
    for (let k = 0; k < 4; k++) {
      const c = cells[p + dirs[k]];
      if (c !== color && c !== BORDER) return false;
    }
    const opp = 3 - color;
    let bad = 0;
    let edge = false;
    for (let k = 0; k < 4; k++) {
      const c = cells[p + diags[k]];
      if (c === opp) bad++;
      else if (c === BORDER) edge = true;
    }
    return edge ? bad === 0 : bad < 2;
  }

  /** Whether playing at p would leave the new chain with one liberty without capturing. */
  isSelfAtari(p: number, color: number): boolean {
    const { cells, dirs } = this;
    const opp = 3 - color;
    let empties = 0;
    for (let k = 0; k < 4; k++) {
      const r = p + dirs[k];
      const c = cells[r];
      if (c === EMPTY) empties++;
      else if (c === opp && this.libs(r, 1) === 1) return false;
    }
    if (empties >= 2) return false;
    cells[p] = color;
    const l = this.libs(p, 1);
    cells[p] = EMPTY;
    return l <= 1;
  }

  /** Plays if legal (no suicide, no simple ko). */
  tryPlay(p: number, color: number): boolean {
    const { cells, dirs } = this;
    if (cells[p] !== EMPTY || p === this.ko) return false;
    const opp = 3 - color;
    let legal = false;
    for (let k = 0; k < 4 && !legal; k++) {
      const r = p + dirs[k];
      const c = cells[r];
      if (c === EMPTY) legal = true;
      else if (c === color) legal = this.libs(r, 1) > 1;
      else if (c === opp) legal = this.libs(r, 1) === 1;
    }
    if (!legal) return false;

    cells[p] = color;
    let captured = 0;
    let lastCaptured = -1;
    let friendly = false;
    for (let k = 0; k < 4; k++) {
      const r = p + dirs[k];
      const c = cells[r];
      if (c === color) friendly = true;
      else if (c === opp && this.libs(r, 0) === 0) {
        captured += this.remove(r);
        lastCaptured = r;
      }
    }
    this.ko = captured === 1 && !friendly && this.libs(p, 1) === 1 ? lastCaptured : -1;
    return true;
  }

  /** Area owner of a padded point once play has finished. */
  owner(p: number): number {
    const { cells, dirs } = this;
    const c = cells[p];
    if (c !== EMPTY) return c;
    let seen = 0;
    for (let k = 0; k < 4; k++) {
      const n = cells[p + dirs[k]];
      if (n === BLACK || n === WHITE) {
        if (seen && seen !== n) return EMPTY;
        seen = n;
      }
    }
    return seen;
  }
}

/**
 * A reply to the last move at `last`: capture a chain left in atari, or
 * extend a friendly chain out of atari when that gains liberties.
 */
function tacticalReply(b: FastBoard, last: number, color: number): number {
  const { cells, dirs } = b;
  const opp = 3 - color;
  if (b.libs(last, 1) === 1 && b.tryPlay(b.lastLib, color)) return b.lastLib;
  for (let k = 0; k < 4; k++) {
    const n = last + dirs[k];
    const c = cells[n];
    if (c === opp && b.libs(n, 1) === 1 && b.tryPlay(b.lastLib, color)) return b.lastLib;
    if (c === color && b.libs(n, 1) === 1) {
      const lib = b.lastLib;
      let open = 0;
      for (let j = 0; j < 4; j++) if (cells[lib + dirs[j]] === EMPTY) open++;
      if (open >= 2 && b.tryPlay(lib, color)) return lib;
    }
  }
  return -1;
}

function sensible(b: FastBoard, p: number, color: number, avoidSelfAtari: boolean) {
  return b.cells[p] === EMPTY && !b.isEye(p, color) && !(avoidSelfAtari && b.isSelfAtari(p, color));
}

/** Plays to the end, recording the first colour to play at each padded point. */
function playout(b: FastBoard, toPlay: number, random: () => number, firstMover: Uint8Array | null) {
  const nn = b.n * b.n;
  const padOf = b.padOf;
  const maxMoves = nn * 3;
  let color = toPlay;
  let passes = 0;
  let last = -1;
  for (let m = 0; m < maxMoves && passes < 2; m++) {
    let played = last >= 0 ? tacticalReply(b, last, color) : -1;
    for (let t = 0; t < 8 && played < 0; t++) {
      const p = padOf[Math.floor(random() * nn)];
      if (sensible(b, p, color, true) && b.tryPlay(p, color)) played = p;
    }
    // Scan everything, first without self-atari moves, then allowing them.
    for (let round = 0; round < 2 && played < 0; round++) {
      const start = Math.floor(random() * nn);
      for (let i = 0; i < nn && played < 0; i++) {
        const p = padOf[(start + i) % nn];
        if (sensible(b, p, color, round === 0) && b.tryPlay(p, color)) played = p;
      }
    }
    if (played < 0) passes++;
    else {
      passes = 0;
      if (firstMover && !firstMover[played]) firstMover[played] = color;
    }
    last = played;
    color = 3 - color;
  }
}

/** A first-line point with no stone within two points: almost never a good move. */
function isLonelyEdge(state: GameState, p: number): boolean {
  const n = state.size;
  const r = Math.floor(p / n);
  const c = p % n;
  if (n < 7 || (r !== 0 && r !== n - 1 && c !== 0 && c !== n - 1)) return false;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (Math.abs(dr) + Math.abs(dc) > 2 || rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      if (state.board[rr * n + cc] !== EMPTY) return false;
    }
  }
  return true;
}

export class Search {
  readonly total: number;
  done = 0;
  private readonly state: GameState;
  private readonly me: Stone;
  private readonly root: FastBoard;
  private readonly scratch: FastBoard;
  private readonly random: () => number;
  private readonly candidates: number[];
  private readonly candPadded: number[];
  private readonly n: Float64Array;
  private readonly w: Float64Array;
  private readonly amafN: Float64Array;
  private readonly amafW: Float64Array;
  private readonly ownership: Float64Array;
  private readonly firstMover: Uint8Array;

  constructor(state: GameState, opts: SearchOptions = {}) {
    this.state = state;
    this.total = opts.playouts ?? defaultPlayouts(state.size);
    this.me = stoneOf(state.toPlay);
    this.root = FastBoard.from(state);
    this.scratch = new FastBoard(state.size);
    this.random = rng((opts.seed ?? 1) ^ Math.imul(state.moves.length + 1, 2654435761));
    this.candidates = [];
    for (let i = 0; i < state.board.length; i++) {
      if (state.board[i] !== EMPTY) continue;
      if (this.root.isEye(this.root.padOf[i], this.me)) continue;
      if (isLonelyEdge(state, i)) continue;
      if (play(state, i).ok) this.candidates.push(i);
    }
    this.candPadded = this.candidates.map((i) => this.root.padOf[i]);
    const k = this.candidates.length;
    this.n = new Float64Array(k);
    this.w = new Float64Array(k);
    this.amafN = new Float64Array(k);
    this.amafW = new Float64Array(k);
    this.ownership = new Float64Array(state.board.length);
    this.firstMover = new Uint8Array(this.root.cells.length);
  }

  get finished() {
    return this.done >= this.total;
  }

  /** Runs up to `count` more playouts. */
  run(count: number) {
    const end = Math.min(this.total, this.done + count);
    for (; this.done < end; this.done++) this.iterate();
  }

  private blended(i: number): number {
    const n = this.n[i];
    const mean = n ? this.w[i] / n : 0.5;
    const an = this.amafN[i];
    if (!an) return mean;
    const beta = Math.sqrt(1000 / (3 * n + 1000));
    return (1 - beta) * mean + beta * (this.amafW[i] / an);
  }

  private select(): number {
    let best = -1;
    let bestValue = -Infinity;
    const logT = Math.log(this.done + 1);
    for (let i = 0; i < this.candidates.length; i++) {
      const v = this.blended(i) + 0.4 * Math.sqrt(logT / (this.n[i] + 1));
      if (v > bestValue) {
        bestValue = v;
        best = i;
      }
    }
    return best;
  }

  private iterate() {
    const b = this.scratch;
    b.copyFrom(this.root);
    this.firstMover.fill(0);
    const i = this.candidates.length ? this.select() : -1;
    const opp = 3 - this.me;
    if (i >= 0) b.tryPlay(this.candPadded[i], this.me);
    playout(b, i >= 0 ? opp : this.me, this.random, this.firstMover);

    let black = 0;
    let white = this.state.komi;
    for (let q = 0; q < this.ownership.length; q++) {
      const o = b.owner(b.padOf[q]);
      if (o === BLACK) {
        black++;
        this.ownership[q]++;
      } else if (o === WHITE) {
        white++;
        this.ownership[q]--;
      }
    }
    const win = black > white === (this.me === BLACK) ? 1 : 0;
    if (i >= 0) {
      this.n[i]++;
      this.w[i] += win;
    }
    for (let j = 0; j < this.candidates.length; j++) {
      if (this.firstMover[this.candPadded[j]] === this.me) {
        this.amafN[j]++;
        this.amafW[j] += win;
      }
    }
  }

  /** Average ownership per point in [-1, 1]: +1 always Black, -1 always White. */
  ownershipMap(): number[] {
    const t = Math.max(1, this.done);
    return Array.from(this.ownership, (o) => o / t);
  }
}

/** A chain on the board and how often it survived: the share of playouts in which its colour kept its points. */
export interface ChainSurvival {
  stones: number[];
  survived: number;
}

/** Whether some chain's survival, read from an ownership map in [-1, 1], is too close to call. */

/** Each chain's share of playouts survived, from summed ownership over `total` playouts (Black +1, White -1). */
export function survivalFrom(state: GameState, own: ArrayLike<number>, total: number): ChainSurvival[] {
  const out: ChainSurvival[] = [];
  const visited = new Set<number>();
  for (let p = 0; p < state.board.length; p++) {
    const s = state.board[p];
    if (s === EMPTY || visited.has(p)) continue;
    const stones = chainAt(state.board, state.size, p).stones;
    stones.forEach((q) => visited.add(q));
    const avg = stones.reduce((sum, q) => sum + own[q], 0) / (stones.length * total);
    out.push({ stones, survived: (1 + (s === BLACK ? avg : -avg)) / 2 });
  }
  return out;
}

/**
 * Random playouts from a position, run a few at a time so a phone can spread them over frames.
 * `sums` adds up who owned each point at the end of each playout: Black +1, White -1.
 */
export class Playouts {
  readonly sums: Float64Array;
  done = 0;
  readonly total: number;
  private readonly root: FastBoard;
  private readonly b: FastBoard;
  private readonly random: () => number;
  private readonly toPlay: number;

  constructor(
    readonly state: GameState,
    opts: SearchOptions = {},
  ) {
    this.root = FastBoard.from(state);
    this.b = new FastBoard(state.size);
    this.random = rng((opts.seed ?? 1) ^ 0x9e3779b9);
    this.total = opts.playouts ?? defaultPlayouts(state.size);
    this.sums = new Float64Array(state.board.length);
    this.toPlay = stoneOf(state.toPlay);
  }

  get finished() {
    return this.done >= this.total;
  }

  run(count: number) {
    const { b, sums } = this;
    for (let i = 0; i < count && this.done < this.total; i++, this.done++) {
      b.copyFrom(this.root);
      playout(b, this.done % 2 ? this.toPlay : 3 - this.toPlay, this.random, null);
      for (let q = 0; q < sums.length; q++) {
        const o = b.owner(b.padOf[q]);
        if (o === BLACK) sums[q]++;
        else if (o === WHITE) sums[q]--;
      }
    }
  }
}

/** Every chain on the board with how often it survives random playouts from this position. */
export function chainSurvival(state: GameState, opts: SearchOptions = {}): ChainSurvival[] {
  const p = new Playouts(state, opts);
  p.run(p.total);
  return survivalFrom(state, p.sums, p.total);
}

/** Where the game seems headed: each player's expected area, and who mostly holds each point. */
export interface Projection {
  /** Points each player can expect, to the nearest whole point, komi included for White. */
  black: number;
  white: number;
  /** BLACK or WHITE for a point one player holds in about two playouts of three, EMPTY where it is open. */
  owner: Stone[];
}

/**
 * A point the previous estimate gave a player stays theirs while they hold it in more than this share
 * of playouts (Black +1, White -1): 55%. Taking a point needs two playouts of three, so a point near
 * that line does not flicker between estimates that differ only by chance.
 */
const STILL_HELD = 0.1;

/**
 * The score the playouts point to: every point counts for each player by the share of playouts in which
 * they hold it, so open areas split instead of counting for nobody. With the `previous` estimate's owners,
 * points it gave a player stay theirs until their hold clearly weakens.
 */
export function projectScore(p: Playouts, previous?: readonly Stone[]): Projection {
  return projectionOf(p.sums, p.done, p.state.komi, previous);
}

/** The projection from ownership `sums` (Black +1, White -1 per playout) over `done` playouts. */
function projectionOf(sums: Float64Array, done: number, komi: number, previous?: readonly Stone[]): Projection {
  const n = Math.max(1, done);
  let lean = 0;
  const owner = Array.from(sums, (sum, q) => {
    const o = sum / n;
    lean += o;
    if (previous?.[q] === BLACK && o > STILL_HELD) return BLACK;
    if (previous?.[q] === WHITE && o < -STILL_HELD) return WHITE;
    return o > 1 / 3 ? BLACK : o < -1 / 3 ? WHITE : EMPTY;
  }) as Stone[];
  // Each point is worth (1 + o) / 2 to Black and (1 - o) / 2 to White.
  const area = sums.length;
  return { black: Math.round((area + lean) / 2), white: Math.round((area - lean) / 2) + komi, owner };
}

/** Below this share of surviving playouts a chain is suggested dead. */
export const DEAD_BELOW = 0.25;
/**
 * Between these shares the playouts are split: the chain's fate depends on moves still to be
 * played, so the suggestion is a guess the players should check, or settle by playing on.
 */
const UNSURE_FROM = 0.2;
const UNSURE_TO = 0.6;
export const isUnsure = (c: ChainSurvival) => c.survived >= UNSURE_FROM && c.survived < UNSURE_TO;

/**
 * Suggests dead stones: chains that random playouts from this position mostly end up losing to
 * the other colour. `unsure` lists the stones of chains whose fate the playouts could not settle.
 */
export function guessDead(state: GameState, opts: SearchOptions = {}): { dead: number[]; unsure: number[] } {
  const p = new Playouts(state, opts);
  p.run(p.total);
  return deadFrom(p);
}

/** `guessDead` from playouts already run, so a caller can run them in slices. */
export function deadFrom(p: Playouts): { dead: number[]; unsure: number[] } {
  return deadFromOwnership(
    p.state,
    Float64Array.from(p.sums, (v) => v / p.total),
  );
}

/** `guessDead` from an ownership map in [-1, 1] (Black +1), such as a network's, by the same thresholds. */
export function deadFromOwnership(state: GameState, own: ArrayLike<number>): { dead: number[]; unsure: number[] } {
  const chains = survivalFrom(state, own, 1);
  const pick = (keep: (c: ChainSurvival) => boolean) =>
    chains
      .filter(keep)
      .flatMap((c) => c.stones)
      .sort((x, y) => x - y);
  return { dead: pick((c) => c.survived < DEAD_BELOW), unsure: pick(isUnsure) };
}

/** How many points neither player holds in most playouts from this position: the space still to play for. */
export function openPoints(state: GameState, opts: SearchOptions = {}): number {
  const s = new Search(state, opts);
  s.run(s.total);
  return openPointsFrom(s);
}

/** `openPoints` from a search already run, so a caller can run it in slices. */
export const openPointsFrom = (s: Search): number => s.ownershipMap().filter((o) => Math.abs(o) <= 0.5).length;

export function estimateDead(state: GameState, opts: SearchOptions = {}): number[] {
  return guessDead(state, opts).dead;
}
