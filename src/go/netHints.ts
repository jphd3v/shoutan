/**
 * The Coach: what the network's reading of a position says to the player to move. Which groups
 * are lost, open or about to die, the strongest moves, and what the last move cost. Pure: the readings
 * come from the native network (`modules/go-net`) through `katago.ts`.
 */
import { DEAD_BELOW, isUnsure, survivalFrom } from './ai';
import type { NetReading } from './katago';
import { Color, colorOf, GameState, other, play } from './rules';

export type GroupStatus = 'lost' | 'urgent' | 'weak';

export interface StatusGroup {
  status: GroupStatus;
  color: Color;
  /** Ascending points of the chain's stones. */
  stones: number[];
}

/** A smaller loss than this is within the network's noise, so it gets no note. */
const COST_FROM = 3;

/**
 * The same board with the other player to move, as if the player passed: read by the network, it
 * shows what the opponent would do with a free move.
 */
export const withOpponentToPlay = (state: GameState): GameState => ({ ...state, toPlay: other(state.toPlay) });

/** Ownership with Black +1, from a reading made for `toPlay`. */
const blackOwnership = (r: NetReading, toPlay: Color) => (toPlay === 'black' ? r.ownership : Float64Array.from(r.ownership, (o) => -o));

/**
 * The chains worth outlining. `mine` is the reading for the player to move; `theirs`, for the same board
 * with the opponent to move (`withOpponentToPlay`), shows which of the player's chains live now but
 * die if the player doesn't answer.
 */
export function groupStatus(state: GameState, mine: NetReading, theirs: NetReading | null): StatusGroup[] {
  const now = survivalFrom(state, blackOwnership(mine, state.toPlay), 1);
  // Both lists walk the board in the same order, so a chain has the same index in each.
  const ifPassed = theirs ? survivalFrom(state, blackOwnership(theirs, other(state.toPlay)), 1) : null;
  const out: StatusGroup[] = [];
  now.forEach((c, i) => {
    const color = colorOf(state.board[c.stones[0]]);
    const stones = [...c.stones].sort((a, b) => a - b);
    if (c.survived < DEAD_BELOW) out.push({ status: 'lost', color, stones });
    else if (color === state.toPlay && ifPassed && ifPassed[i].survived < DEAD_BELOW) out.push({ status: 'urgent', color, stones });
    else if (isUnsure(c)) out.push({ status: 'weak', color, stones });
  });
  return out;
}

/** The network's favourite move, and the next one too when it is at least half as likely. None when it would rather pass. */
export function strongestMoves(state: GameState, r: NetReading): number[] {
  const cells = state.size * state.size;
  const order = Array.from(r.policy.keys())
    .filter((i) => i !== cells)
    .sort((a, b) => r.policy[b] - r.policy[a]);
  const legal: number[] = [];
  for (const i of order) {
    if (legal.length === 2) break;
    if (play(state, i).ok) legal.push(i);
  }
  const [first, second] = legal;
  if (first === undefined || r.policy[cells] > r.policy[first]) return [];
  return second !== undefined && r.policy[second] * 2 >= r.policy[first] ? [first, second] : [first];
}

/**
 * What the move from `before` to `after` gave away, in points, with the move the network liked best
 * instead. `beforeReading` is for the player who moved; `afterReading` for their opponent, who moves next.
 * Null for a small loss, or when the move was the network's favourite.
 */
export function moveCost(
  before: GameState,
  beforeReading: NetReading,
  after: GameState,
  afterReading: NetReading,
): { lost: number; better: number } | null {
  const move = after.moves[after.moves.length - 1];
  if (after.moves.length !== before.moves.length + 1 || move?.kind !== 'play' || move.color !== before.toPlay) return null;
  const lost = beforeReading.lead + afterReading.lead;
  const better = strongestMoves(before, beforeReading)[0];
  if (lost < COST_FROM || better === undefined || better === move.point) return null;
  return { lost: Math.round(lost), better };
}
