/** How an area score is made up, as regions and steps the board can show one at a time. */
import { BLACK, Color, EMPTY, GameState, neighbors, score, Stone, stoneOf, WHITE } from './rules';

export interface Region {
  owner: typeof BLACK | typeof WHITE;
  /** Ascending point indices; includes stones marked dead inside it. */
  points: number[];
}

export interface CountStep {
  /** Whose score the step adds to; null for the dead stones, which can be of both colours. */
  color: Color | null;
  /**
   * `dead` shows the stones taken off before counting; they add nothing by themselves. `shared`
   * is the points between both sides' stones, and adds `add`, half of them, to each player.
   */
  kind: 'dead' | 'stones' | 'territory' | 'shared' | 'komi';
  /** Points this step counts (none for komi). */
  points: number[];
  add: number;
}

export interface Breakdown {
  stones: number;
  territory: number;
  /** Half the points between both sides' stones. */
  shared: number;
  komi: number;
}

export interface CountPlan {
  steps: CountStep[];
  total: { black: number; white: number };
  breakdown: { black: Breakdown; white: Breakdown };
}

/** Connected territory of one owner, in board order. Neutral points belong to no region. */
export function territoryRegions(state: GameState): Region[] {
  const { owner } = score(state);
  const isArea = (p: number) => owner[p] !== EMPTY && (state.board[p] === EMPTY || state.dead.has(p));
  const seen = new Set<number>();
  const regions: Region[] = [];
  for (let p = 0; p < owner.length; p++) {
    if (seen.has(p) || !isArea(p)) continue;
    const points: number[] = [];
    const stack = [p];
    seen.add(p);
    while (stack.length) {
      const q = stack.pop()!;
      points.push(q);
      for (const n of neighbors(state.size, q)) {
        if (!seen.has(n) && isArea(n) && owner[n] === owner[p]) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    regions.push({ owner: owner[p] as Region['owner'], points: points.sort((a, b) => a - b) });
  }
  return regions;
}

/**
 * Territory that has formed during play: empty areas only one player's stones touch, with any
 * dead-stone marks ignored. An area larger than half the board is still open play, not territory,
 * so a lone first stone does not claim the whole board.
 */
export function formedTerritory(state: GameState): Region[] {
  return territoryRegions({ ...state, dead: new Set() }).filter((r) => r.points.length * 2 <= state.board.length);
}

export function countPlan(state: GameState): CountPlan {
  const regions = territoryRegions(state);
  const steps: CountStep[] = [];
  const breakdown = {
    black: { stones: 0, territory: 0, shared: 0, komi: 0 },
    white: { stones: 0, territory: 0, shared: 0, komi: 0 },
  };
  const dead = [...state.dead].filter((p) => state.board[p] !== EMPTY).sort((a, b) => a - b);
  if (dead.length) steps.push({ color: null, kind: 'dead', points: dead, add: 0 });
  for (const color of ['black', 'white'] as const) {
    const stone: Stone = stoneOf(color);
    const stones = state.board.flatMap((s, p) => (s === stone && !state.dead.has(p) ? [p] : []));
    if (stones.length) steps.push({ color, kind: 'stones', points: stones, add: stones.length });
    breakdown[color].stones = stones.length;
    const territory = regions.flatMap((r) => (r.owner === stone ? r.points : [])).sort((a, b) => a - b);
    if (territory.length) steps.push({ color, kind: 'territory', points: territory, add: territory.length });
    breakdown[color].territory = territory.length;
  }
  const { owner, shared } = score(state);
  if (shared) {
    const points = owner.flatMap((o, p) => (o === EMPTY && (state.board[p] === EMPTY || state.dead.has(p)) ? [p] : []));
    steps.push({ color: 'black', kind: 'shared', points, add: shared / 2 });
    breakdown.black.shared = breakdown.white.shared = shared / 2;
  }
  if (state.komi) steps.push({ color: 'white', kind: 'komi', points: [], add: state.komi });
  breakdown.white.komi = state.komi;
  const sum = (b: Breakdown) => b.stones + b.territory + b.shared + b.komi;
  return { steps, total: { black: sum(breakdown.black), white: sum(breakdown.white) }, breakdown };
}
