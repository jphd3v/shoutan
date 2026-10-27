import type { NetReading } from '../katago';
import { groupStatus, moveCost, strongestMoves, withOpponentToPlay } from '../netHints';
import { GameState, pointFromName } from '../rules';
import { playAll, position } from './helpers';

const pt = (state: GameState, name: string) => pointFromName(state.size, name);

/**
 * A reading for `state`'s player to move. `blackOwn` gives each point's ownership with Black +1, as
 * diagrams read more easily; `policy` names the likeliest points with their probabilities.
 */
function reading(
  state: GameState,
  {
    blackOwn = () => 0,
    policy = {},
    pass = 0,
    lead = 0,
  }: { blackOwn?: (p: number) => number; policy?: Record<string, number>; pass?: number; lead?: number },
): NetReading {
  const cells = state.size * state.size;
  const flip = state.toPlay === 'black' ? 1 : -1;
  const p = new Float64Array(cells + 1);
  for (const [name, v] of Object.entries(policy)) p[pt(state, name)] = v;
  p[cells] = pass;
  return { policy: p, win: 0.5, lead, ownership: Float64Array.from({ length: cells }, (_, i) => blackOwn(i) * flip) };
}

describe('groupStatus', () => {
  const g = position(['.....', '.X...', '...O.', '.....', '.....']);
  const b2 = pt(g, 'B4');
  const w = pt(g, 'D3');

  it('calls stones lost where the network gives their points to the other colour', () => {
    const mine = reading(g, { blackOwn: () => 1 });
    expect(groupStatus(g, mine, null)).toEqual([{ status: 'lost', color: 'white', stones: [w] }]);
  });

  it('calls stones weak where their fate is open', () => {
    const mine = reading(g, { blackOwn: (p) => (p === w ? 0 : 1) });
    expect(groupStatus(g, mine, null)).toEqual([{ status: 'weak', color: 'white', stones: [w] }]);
  });

  it('calls the player’s own stones urgent when they live now but die if the opponent moves first', () => {
    const mine = reading(g, { blackOwn: (p) => (p === w ? -1 : 1) });
    const theirs = reading(withOpponentToPlay(g), { blackOwn: (p) => (p === b2 ? -1 : p === w ? -1 : 1) });
    expect(groupStatus(g, mine, theirs)).toEqual([{ status: 'urgent', color: 'black', stones: [b2] }]);
  });

  it('a weak group of the player’s that dies if the opponent moves first is urgent, not weak', () => {
    const mine = reading(g, { blackOwn: (p) => (p === b2 ? 0 : p === w ? -1 : 1) });
    const theirs = reading(withOpponentToPlay(g), { blackOwn: (p) => (p === b2 ? -1 : p === w ? -1 : 1) });
    expect(groupStatus(g, mine, theirs)).toEqual([{ status: 'urgent', color: 'black', stones: [b2] }]);
  });

  it('the opponent’s stones are never urgent: that would be the player’s chance, not a warning', () => {
    const white = withOpponentToPlay(g);
    const mine = reading(white, { blackOwn: (p) => (p === w ? -1 : 1) });
    const theirs = reading(g, { blackOwn: (p) => (p === b2 ? -1 : p === w ? -1 : 1) });
    expect(groupStatus(white, mine, theirs)).toEqual([]);
  });
});

describe('strongestMoves', () => {
  const g = position(['.....', '.X...', '.....', '.....', '.....']);

  it('gives the network’s favourite, and the next only when it is nearly as likely', () => {
    expect(strongestMoves(g, reading(g, { policy: { C3: 0.4, D2: 0.25, A1: 0.1 } }))).toEqual([pt(g, 'C3'), pt(g, 'D2')]);
    expect(strongestMoves(g, reading(g, { policy: { C3: 0.6, D2: 0.2 } }))).toEqual([pt(g, 'C3')]);
  });

  it('skips points where the move isn’t allowed', () => {
    expect(strongestMoves(g, reading(g, { policy: { B4: 0.5, C3: 0.3 } }))).toEqual([pt(g, 'C3')]);
  });

  it('is empty when the network would rather pass', () => {
    expect(strongestMoves(g, reading(g, { policy: { C3: 0.2 }, pass: 0.7 }))).toEqual([]);
  });
});

describe('moveCost', () => {
  const before = position(['.....', '.....', '.....', '.....', '.....']);
  const after = playAll(before, 'A1');

  it('is the points the move gave away, with the stronger move', () => {
    const r = moveCost(before, reading(before, { lead: 5, policy: { C3: 0.8 } }), after, reading(after, { lead: 3 }));
    expect(r).toEqual({ lost: 8, better: pt(before, 'C3') });
  });

  it('is null for a small loss, or when the move was the network’s own choice', () => {
    expect(moveCost(before, reading(before, { lead: 5, policy: { C3: 0.8 } }), after, reading(after, { lead: -3 }))).toBeNull();
    expect(moveCost(before, reading(before, { lead: 5, policy: { A1: 0.8 } }), after, reading(after, { lead: 5 }))).toBeNull();
  });

  it('is null when the positions are not one move apart', () => {
    const later = playAll(after, 'C3');
    expect(moveCost(before, reading(before, { lead: 5, policy: { C3: 0.8 } }), later, reading(later, { lead: 3 }))).toBeNull();
  });
});
