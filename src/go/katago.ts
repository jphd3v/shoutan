/**
 * The bot, levels 1–7: a small KataGo network (see `modules/go-net/README.md`) read once per move. This
 * file is the network's language and each level's choice; running the network is the native module's job.
 *
 * The inputs are KataGo's version 7 features, for the player to move. The ladder planes (14–17) are left
 * empty: the network plays well without them. The area planes (18–19) are not: without them the network
 * sees a board worth nothing but komi, and passes early in games it leads.
 */
import { deadFromOwnership, rng } from './ai';
import { BLACK, chainAt, EMPTY, GameState, neighbors, play, score, setDead, Stone, stoneOf, WHITE } from './rules';

export const NET_PLANES = 22;
export const NET_GLOBALS = 19;

export interface NetInputs {
  /** NET_PLANES planes of size × size, 0 or 1. */
  planes: Uint8Array;
  globals: number[];
}

/** The bot's move. */
export type AiDecision =
  { kind: 'play'; point: number; winRate: number } | { kind: 'pass'; winRate: number } | { kind: 'resign'; winRate: number };

/** What the network answers, unprocessed: logits, and ownership before tanh. */
export interface NetOutputs {
  policy: ArrayLike<number>;
  pass: ArrayLike<number>;
  value: ArrayLike<number>;
  score: ArrayLike<number>;
  ownership: ArrayLike<number>;
}

export interface NetReading {
  /** Move probabilities over the points, then pass at index size × size. */
  policy: Float64Array;
  /** The player to move's chance of winning. */
  win: number;
  /** Points ahead for the player to move. */
  lead: number;
  /** Per point in [-1, 1]: +1 owned by the player to move. */
  ownership: Float64Array;
}

export function encode(state: GameState): NetInputs {
  const n = state.size;
  const cells = n * n;
  const planes = new Uint8Array(NET_PLANES * cells);
  const globals = new Array<number>(NET_GLOBALS).fill(0);
  const me = stoneOf(state.toPlay);
  const them = me === BLACK ? WHITE : BLACK;
  const set = (plane: number, p: number) => (planes[plane * cells + p] = 1);
  const liberties = new Map<number, number>();
  // Only a capture can bring a position back, so only these points can be refused for ko.
  const captures = new Set<number>();
  for (let p = 0; p < cells; p++) {
    set(0, p);
    const s = state.board[p];
    if (s === EMPTY) continue;
    set(s === me ? 1 : 2, p);
    let libs = liberties.get(p);
    if (libs === undefined) {
      const chain = chainAt(state.board, n, p);
      libs = chain.liberties.size;
      for (const q of chain.stones) liberties.set(q, libs);
      if (s === them && libs === 1) for (const q of chain.liberties) captures.add(q);
    }
    if (libs >= 1 && libs <= 3) set(2 + libs, p);
  }
  const owners = area(state.board, n);
  for (let p = 0; p < cells; p++) if (owners[p] !== EMPTY) set(owners[p] === me ? 18 : 19, p);
  for (const p of captures) {
    const r = play(state, p);
    if (!r.ok && r.reason === 'ko') set(6, p);
  }
  // The last five moves, most recent first, alternating: the opponent's, then the player's own.
  const moves = state.moves;
  for (let k = 0; k < 5 && k < moves.length; k++) {
    const m = moves[moves.length - 1 - k];
    if (stoneOf(m.color) !== (k % 2 === 0 ? them : me)) break;
    if (m.kind === 'pass') globals[k] = 1;
    else if (m.kind === 'play') set(9 + k, m.point);
  }
  const selfKomi = state.toPlay === 'white' ? state.komi : -state.komi;
  globals[5] = selfKomi / 20;
  // Situational superko, as `rules.ts` plays it.
  globals[6] = 1;
  globals[7] = -0.5;
  // Area scoring, so 8–13 stay 0. A pass after a pass ends play.
  globals[14] = state.consecutivePasses > 0 ? 1 : 0;
  // Komi's parity against the board, a triangle wave, as KataGo works it out.
  const floor = cells % 2 === 0 ? Math.floor(selfKomi / 2) * 2 : Math.floor((selfKomi - 1) / 2) * 2 + 1;
  const delta = Math.min(2, Math.max(0, selfKomi - floor));
  globals[18] = delta < 0.5 ? delta : delta < 1.5 ? 1 - delta : delta - 2;
  return { planes, globals };
}

/**
 * Who would score each point if play stopped now, as KataGo shows it to the network under area scoring
 * (`Board::calculateArea`): groups that can never be captured (Benson's test) with their territory,
 * enemy stones in it included; empty areas touching one colour only; then every other stone for its colour.
 */
export function area(board: readonly Stone[], size: number): Stone[] {
  const owners: Stone[] = new Array(board.length).fill(EMPTY);
  areaFor(BLACK, board, size, owners);
  areaFor(WHITE, board, size, owners);
  for (let p = 0; p < board.length; p++) if (owners[p] === EMPTY) owners[p] = board[p];
  return owners;
}

function areaFor(me: Stone, board: readonly Stone[], size: number, owners: Stone[]) {
  const them = me === BLACK ? WHITE : BLACK;
  const chainOf = new Array<number>(board.length).fill(-1);
  const chains: number[][] = [];
  for (let p = 0; p < board.length; p++) {
    if (board[p] !== me || chainOf[p] >= 0) continue;
    const { stones } = chainAt(board, size, p);
    for (const q of stones) chainOf[q] = chains.length;
    chains.push(stones);
  }
  const chainsBeside = (p: number) => new Set(neighbors(size, p).flatMap((q) => (board[q] === me ? [chainOf[q]] : [])));
  // Regions of empty points and enemy stones, each with the chains it is a vital liberty of: chains
  // beside every empty point in it (suicide is illegal, so enemy stones don't count against that).
  const regionOf = new Array<number>(board.length).fill(-1);
  const regions: { points: number[]; vital: number[]; inner: number; enemy: boolean }[] = [];
  for (let p = 0; p < board.length; p++) {
    if (board[p] !== EMPTY || regionOf[p] >= 0) continue;
    const r = regions.length;
    let vital = chainsBeside(p);
    let inner = 0;
    let enemy = false;
    regionOf[p] = r;
    const points = [p];
    for (let i = 0; i < points.length; i++) {
      const q = points[i];
      const beside = chainsBeside(q);
      if (board[q] === EMPTY) vital = new Set([...vital].filter((c) => beside.has(c)));
      if (beside.size === 0) inner++;
      if (board[q] === them) enemy = true;
      for (const x of neighbors(size, q))
        if (board[x] !== me && regionOf[x] < 0) {
          regionOf[x] = r;
          points.push(x);
        }
    }
    regions.push({ points, vital: [...vital], inner, enemy });
  }
  const vitalCount = new Array<number>(chains.length).fill(0);
  for (const r of regions) for (const c of r.vital) vitalCount[c]++;
  const dead = new Array<boolean>(chains.length).fill(false);
  const bordersDead = new Array<boolean>(regions.length).fill(false);
  for (let killed = true; killed;) {
    killed = false;
    chains.forEach((stones, c) => {
      if (dead[c] || vitalCount[c] >= 2) return;
      dead[c] = killed = true;
      for (const s of stones)
        for (const x of neighbors(size, s)) {
          const r = regionOf[x];
          if (r < 0 || bordersDead[r]) continue;
          bordersDead[r] = true;
          for (const v of regions[r].vital) vitalCount[v]--;
        }
    });
  }
  chains.forEach((stones, c) => {
    if (!dead[c]) for (const s of stones) owners[s] = me;
  });
  if (chains.length === 0) return;
  regions.forEach((r, i) => {
    if (!bordersDead[i] && (r.inner <= 1 || !r.enemy)) for (const p of r.points) owners[p] = me;
    else if (!r.enemy) for (const p of r.points) if (owners[p] === EMPTY) owners[p] = me;
  });
}

export function read(size: number, out: NetOutputs): NetReading {
  const area = size * size;
  const policy = new Float64Array(area + 1);
  let max = out.pass[0];
  for (let i = 0; i < area; i++) max = Math.max(max, out.policy[i]);
  let sum = 0;
  for (let i = 0; i < area; i++) sum += policy[i] = Math.exp(out.policy[i] - max);
  sum += policy[area] = Math.exp(out.pass[0] - max);
  for (let i = 0; i <= area; i++) policy[i] /= sum;
  const v = out.value;
  const vmax = Math.max(v[0], v[1], v[2]);
  const [w, l, d] = [0, 1, 2].map((i) => Math.exp(v[i] - vmax));
  const ownership = new Float64Array(area);
  for (let i = 0; i < area; i++) ownership[i] = Math.tanh(out.ownership[i]);
  return { policy, win: (w + 0.5 * d) / (w + l + d), lead: out.score[0] * 20, ownership };
}

/**
 * How loosely each level follows the network, per board size: `heat` flattens its preferences (0 always
 * plays the favourite), and moves it likes less than `floor` times its favourite are never played, so a
 * weaker level picks another plausible idea, never junk. The two gentlest levels also `slip`: that
 * often they play any of the network's `wide` likeliest moves, as a beginner misses what matters.
 * Measured in matches between neighbouring levels (`modules/go-net/README.md`); 9×9 needs gentler
 * steps, since a few loose moves decide a short game.
 */
export type Looseness = { heat: number; floor: number; slip?: number; wide?: number };
const loose19: readonly Looseness[] = [
  { heat: 4, floor: 0.0005 },
  { heat: 2.5, floor: 0.002 },
  { heat: 1.6, floor: 0.005 },
  { heat: 1, floor: 0.01 },
  { heat: 0, floor: 1 },
];
const LOOSENESS: Record<number, readonly Looseness[]> = {
  9: [
    { heat: 2.2, floor: 0.002, slip: 0.5, wide: 20 },
    { heat: 2.2, floor: 0.002, slip: 0.25, wide: 10 },
    { heat: 2.2, floor: 0.002 },
    { heat: 1.6, floor: 0.004 },
    { heat: 1.2, floor: 0.006 },
    { heat: 0.85, floor: 0.012 },
    { heat: 0, floor: 1 },
  ],
  13: [{ heat: 4, floor: 0.0005, slip: 0.5, wide: 20 }, { heat: 4, floor: 0.0005, slip: 0.3, wide: 15 }, ...loose19],
  19: [{ heat: 4, floor: 0.0005, slip: 0.6, wide: 40 }, { heat: 4, floor: 0.0005, slip: 0.4, wide: 25 }, ...loose19],
};

export const loosenessAt = (size: number, level: number) => (LOOSENESS[size] ?? LOOSENESS[19])[Math.min(7, Math.max(1, level)) - 1];

/** The same number for the same position and level, so the bot is deterministic. */
function positionSeed(state: GameState, level: number): number {
  let h = 2166136261 ^ level ^ (state.toPlay === 'black' ? 0 : 0x5bd1e995);
  for (let i = 0; i < state.board.length; i++) h = Math.imul(h ^ state.board[i], 16777619);
  return Math.imul(h ^ state.moves.length, 16777619);
}

/**
 * The player to move's margin if play stopped now, as this app scores it, with the stones the network
 * sees as dead taken off, as players would mark them.
 */
function marginNow(state: GameState, r: NetReading) {
  const me = stoneOf(state.toPlay);
  const dead: number[] = [];
  state.board.forEach((s, p) => {
    if (s !== EMPTY && (s === me ? r.ownership[p] : -r.ownership[p]) < 0) dead.push(p);
  });
  const c = score(setDead({ ...state, phase: 'scoring' }, dead));
  return me === BLACK ? c.black - c.white : c.white - c.black;
}

/**
 * Whether play is over as a beginner would see it: every empty point that touches both colours is one
 * the network sees as no one's (shared, or in a seki), so no border is open and no dead stone is left to capture.
 */
const settled = (state: GameState, r: NetReading) => score(state).owner.every((o, p) => o !== EMPTY || Math.abs(r.ownership[p]) < 0.5);

/**
 * The bot's move at `level` (1 to 7; 7 is the network's favourite every time). It resigns only late in a
 * game it is sure to lose, by a margin no beginner's mistake would make up.
 *
 * Passing follows this app's rules rather than the network's: players take dead stones off by agreement,
 * so after the opponent passes the bot passes whenever it wins the count as the board stands, instead
 * of capturing everything first. It passes first only once the board is `settled`, so dead stones are
 * captured rather than left for the opponent to agree to: far ahead, the network likes passing long before that.
 */
export function decide(state: GameState, r: NetReading, level = 7, loose = loosenessAt(state.size, level)): AiDecision {
  const area = state.size * state.size;
  const winRate = r.win;
  const late = state.moves.length > area / 2;
  if (late && r.win < 0.02 && r.lead < -area / 8) return { kind: 'resign', winRate };
  if (state.consecutivePasses > 0 && marginNow(state, r) > 0) return { kind: 'pass', winRate };
  const order = Array.from(r.policy.keys()).sort((a, b) => r.policy[b] - r.policy[a]);
  const { heat, floor, slip = 0, wide = 0 } = loose;
  const chance = rng(positionSeed(state, level) ^ 0x2545f491);
  if (state.consecutivePasses === 0 && order[0] !== area && chance() < slip) {
    const me = stoneOf(state.toPlay);
    const ideas = order
      .filter((i) => i !== area && !neighbors(state.size, i).every((q) => state.board[q] === me) && play(state, i).ok)
      .slice(0, wide);
    if (ideas.length > 0) return { kind: 'play', point: ideas[Math.floor(chance() * ideas.length)], winRate };
  }
  if (order[0] !== area && heat > 0) {
    const top = r.policy[order[0]];
    const ideas: [number, number][] = [];
    let sum = 0;
    for (const i of order) {
      if (r.policy[i] < top * floor) break;
      if (i === area || !play(state, i).ok) continue;
      const w = Math.pow(r.policy[i] / top, 1 / heat);
      ideas.push([i, w]);
      sum += w;
    }
    let x = rng(positionSeed(state, level))() * sum;
    for (const [i, w] of ideas) if ((x -= w) <= 0) return { kind: 'play', point: i, winRate };
  }
  const legal = (i: number) => i !== area && play(state, i).ok;
  const move = order.find(legal);
  if (move === undefined) return { kind: 'pass', winRate };
  if (r.policy[area] < r.policy[move]) return { kind: 'play', point: move, winRate };
  if (settled(state, r)) return { kind: 'pass', winRate };
  // Playing on where the network would pass: anything but filling one of its own eyes.
  const me = stoneOf(state.toPlay);
  const eye = (i: number) => neighbors(state.size, i).every((q) => state.board[q] === me);
  const onward = order.find((i) => legal(i) && !eye(i));
  return onward === undefined ? { kind: 'pass', winRate } : { kind: 'play', point: onward, winRate };
}

/** The likely dead stones after two passes, from the network's ownership, as `guessDead` reads playouts. */
export function deadFromNet(state: GameState, r: NetReading): { dead: number[]; unsure: number[] } {
  const flip = state.toPlay === 'black' ? 1 : -1;
  return deadFromOwnership(
    state,
    Float64Array.from(r.ownership, (o) => o * flip),
  );
}
