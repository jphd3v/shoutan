import { estimateDead, guessDead, Playouts, projectScore, Search } from '../ai';
import { BLACK, EMPTY, GameState, newGame, pass, pointFromName, score, setDead, Stone } from '../rules';
import { playAll, position } from './helpers';

const pt = (g: GameState, name: string) => pointFromName(g.size, name);

describe('playouts', () => {
  it('runs incrementally to the same result as a single run', () => {
    const g = newGame(9);
    const a = new Search(g, { playouts: 400, seed: 3 });
    while (!a.finished) a.run(37);
    const b = new Search(g, { playouts: 400, seed: 3 });
    b.run(400);
    expect(a.ownershipMap()).toEqual(b.ownershipMap());
  });

  it('marks stones inside settled enemy territory as dead, and only those', () => {
    const g = position([
      '.X.XO.O..',
      'XX.XOOX.O',
      '..XXO.OO.',
      'XX.XOO...',
      '.XXXXOOOO',
      'X.XO.XXXX',
      'XXX.OX...',
      '..XXXX.O.',
      '.X.....X.',
    ]);
    const dead = estimateDead(g, { playouts: 300 });
    expect(dead).toEqual(['G8', 'D4', 'E3', 'H2'].map((n) => pt(g, n)).sort((a, b) => a - b));
    // A finished position leaves nothing to doubt.
    expect(guessDead(g, { playouts: 300 }).unsure).toEqual([]);
    // There the projection is the count itself, dead stones and all.
    const p = new Playouts(g, { playouts: 300 });
    p.run(120);
    expect(p.finished).toBe(false);
    p.run(1000);
    expect(p.done).toBe(300);
    const counted = score(setDead(pass(pass(g)), estimateDead(g, { playouts: 300 })));
    const projected = projectScore(p);
    expect(Math.abs(projected.black - counted.black)).toBeLessThanOrEqual(1);
    expect(Math.abs(projected.white - counted.white)).toBeLessThanOrEqual(1);
  });

  it('says so when the fate of a group is still open', () => {
    // A stone surrounded on three sides may yet escape or be captured, depending on who plays next.
    const open = position([
      '.........',
      '.........',
      '.........',
      '....X....',
      '...XOX...',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);
    expect(guessDead(open, { playouts: 300 }).unsure).toEqual([pt(open, 'E5')]);
  });
});

describe('projectScore', () => {
  it('on an empty board the area splits about evenly, and komi puts White ahead', () => {
    const p = new Playouts(newGame(9), { playouts: 200 });
    p.run(200);
    const { black, white } = projectScore(p);
    expect(Math.abs(black + white - 7.5 - 81)).toBeLessThanOrEqual(1);
    expect(Math.abs(black - 40.5)).toBeLessThan(6);
    expect(white).toBeGreaterThan(black);
  });

  it('keeps a point with the player who held it until their hold clearly weakens', () => {
    const g = playAll(newGame(9), 'C3', 'G7', 'C7', 'G3');
    const p = new Playouts(g, { playouts: 300 });
    p.run(300);
    const share = (q: number) => p.sums[q] / p.done;
    const fresh = projectScore(p).owner;
    // The previous estimate gave every open point to Black: those Black still holds in most playouts stay Black.
    const kept = projectScore(
      p,
      fresh.map(() => BLACK),
    ).owner;
    fresh.forEach((o, q) => {
      if (share(q) > 0.1) expect(kept[q]).toBe(BLACK);
      else expect(kept[q]).toBe(o);
    });
    expect(kept.filter((o) => o === BLACK).length).toBeGreaterThan(fresh.filter((o) => o === BLACK).length);
  });

  it('moves fewer squares from move to move than estimates made afresh', () => {
    let g = newGame(9);
    let fresh: Stone[] | null = null;
    let kept: Stone[] | null = null;
    let freshChanges = 0;
    let keptChanges = 0;
    for (const m of 'C3 G7 C7 G3 E5 D6 F4 E7 D4 C5 B4 F6 H4 H6 E3 F8'.split(' ')) {
      g = playAll(g, m);
      const p = new Playouts(g, { playouts: 300 });
      p.run(300);
      const f: Stone[] = projectScore(p).owner;
      const k: Stone[] = projectScore(p, kept ?? undefined).owner;
      const changed = (a: Stone[] | null, b: Stone[]) => (a ? b.filter((o, q) => g.board[q] === EMPTY && a[q] !== o).length : 0);
      freshChanges += changed(fresh, f);
      keptChanges += changed(kept, k);
      fresh = f;
      kept = k;
    }
    expect(keptChanges).toBeLessThan(freshChanges / 2);
  });
});
