import { countPlan, formedTerritory, territoryRegions } from '../count';
import { BLACK, GameState, pointFromName, score, setDead, WHITE } from '../rules';
import { position } from './helpers';

const markDead = (g: GameState, ...names: string[]) => setDead({ ...g, phase: 'scoring' }, pts(g.size, ...names));
const pts = (size: number, ...names: string[]) => names.map((n) => pointFromName(size, n)).sort((a, b) => a - b);

describe('territoryRegions', () => {
  it('groups connected owned points by owner and leaves neutral points out', () => {
    const g = position(['...X.', '...XO', 'XXXXO', 'OOOOO', '.....']);
    const regions = territoryRegions(g);
    expect(regions).toEqual([
      { owner: BLACK, points: pts(5, 'A5', 'B5', 'C5', 'A4', 'B4', 'C4') },
      { owner: WHITE, points: pts(5, 'A1', 'B1', 'C1', 'D1', 'E1') },
    ]);
  });

  it('counts dead stones as part of the territory that surrounds them', () => {
    const g = markDead(position(['O.X..', '..X..', 'XXXX.', '.....', '.....']), 'A5');
    const [corner] = territoryRegions(g);
    expect(corner).toEqual({ owner: BLACK, points: pts(5, 'A5', 'B5', 'A4', 'B4') });
  });
});

describe('countPlan', () => {
  const g = position(['...X.', '...XO', 'XXXXO', 'OOOOO', '.....']);

  it('counts Black stones, Black territory, White stones, White territory, the shared points, then komi', () => {
    const { steps } = countPlan(g);
    expect(steps.map((s) => `${s.color} ${s.kind} ${s.add}`)).toEqual([
      'black stones 6',
      'black territory 6',
      'white stones 7',
      'white territory 5',
      // E5 touches both colours: half a point each.
      'black shared 0.5',
      'white komi 7.5',
    ]);
    expect(steps.find((s) => s.kind === 'shared')?.points).toEqual(pts(5, 'E5'));
  });

  it('adds up to the area score', () => {
    const plan = countPlan(g);
    const s = score(g);
    expect(plan.total).toEqual({ black: s.black, white: s.white });
    expect(plan.breakdown).toEqual({
      black: { stones: 6, territory: 6, shared: 0.5, komi: 0 },
      white: { stones: 7, territory: 5, shared: 0.5, komi: 7.5 },
    });
  });

  it('leaves dead stones out of the stone count', () => {
    const dead = markDead(g, 'E4');
    const plan = countPlan(dead);
    expect(plan.breakdown.white.stones).toBe(6);
    expect(plan.total).toEqual({ black: score(dead).black, white: score(dead).white });
  });

  it('first shows the stones taken off as dead, adding nothing by themselves', () => {
    const dead = markDead(g, 'E4');
    const [first, second] = countPlan(dead).steps;
    expect(first).toEqual({ color: null, kind: 'dead', points: pts(5, 'E4'), add: 0 });
    expect(second.kind).toBe('stones');
  });

  it('takes the dead stones of both colours off in one step, and the score stays the same', () => {
    const dead = markDead(g, 'E4', 'D5');
    const { steps, total } = countPlan(dead);
    expect(steps.filter((s) => s.kind === 'dead')).toEqual([{ color: null, kind: 'dead', points: pts(5, 'D5', 'E4'), add: 0 }]);
    expect(steps[1].kind).toBe('stones');
    expect(total).toEqual({ black: score(dead).black, white: score(dead).white });
  });

  it('counts all of a player’s territory in one step, however many areas it has', () => {
    const two = position(['.X.X.', 'XXXXX', '.....', 'OOOOO', 'O.O.O']);
    const territory = countPlan(two).steps.filter((s) => s.kind === 'territory');
    expect(territory).toEqual([
      { color: 'black', kind: 'territory', points: pts(5, 'A5', 'C5', 'E5'), add: 3 },
      { color: 'white', kind: 'territory', points: pts(5, 'B1', 'D1'), add: 2 },
    ]);
    expect(countPlan(two).total).toEqual({ black: score(two).black, white: score(two).white });
  });

  it('skips a player with nothing to count', () => {
    const empty = position(['...', '...', '...']);
    expect(countPlan(empty).steps.map((s) => s.kind)).toEqual(['komi']);
  });
});

describe('formedTerritory', () => {
  it('shows areas that only one player’s stones touch', () => {
    const g = position(['.X...', 'XX...', '.....', '...OO', '...O.']);
    expect(formedTerritory(g)).toEqual([
      { owner: BLACK, points: pts(5, 'A5') },
      { owner: WHITE, points: pts(5, 'E1') },
    ]);
  });

  it('leaves open areas that both players’ stones reach', () => {
    const g = position(['.....', '.X...', '.....', '...O.', '.....']);
    expect(formedTerritory(g)).toEqual([]);
  });

  it('shows nothing when one stone stands alone on an open board', () => {
    expect(formedTerritory(position(['.....', '.....', '..X..', '.....', '.....']))).toEqual([]);
  });

  it('ignores stones marked dead: they still keep the area open', () => {
    const g = markDead(position(['O.X..', '..X..', 'XXXX.', '.....', '.....']), 'A5');
    expect(formedTerritory(g)).toEqual([]);
  });
});
