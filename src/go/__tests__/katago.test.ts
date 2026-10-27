import { area, deadFromNet, decide, encode, NET_GLOBALS, NET_PLANES, NetOutputs, read } from '../katago';
import { BLACK, newGame, pass, play, pointFromName } from '../rules';
import { playAll, position } from './helpers';

const plane = (planes: Uint8Array, size: number, k: number) => Array.from(planes.slice(k * size * size, (k + 1) * size * size));
const marked = (planes: Uint8Array, size: number, k: number) => plane(planes, size, k).flatMap((v, p) => (v ? [p] : []));

/** Network outputs with these move logits (point index → logit; the rest very low). */
function outputs(
  size: number,
  logits: Record<number, number>,
  passLogit = -20,
  value = [0, 0, -20],
  lead = 0,
  ownership: number[] = new Array(size * size).fill(0),
): NetOutputs {
  const policy = new Array(size * size).fill(-20);
  for (const [p, v] of Object.entries(logits)) policy[Number(p)] = v;
  return { policy, pass: [passLogit], value, score: [lead / 20], ownership };
}

describe('encode', () => {
  it('gives every board the right shape, from the view of the player to move', () => {
    const s = playAll(newGame(9), 'E5');
    const { planes, globals } = encode(s);
    expect(planes.length).toBe(NET_PLANES * 81);
    expect(globals.length).toBe(NET_GLOBALS);
    expect(marked(planes, 9, 0).length).toBe(81);
    const e5 = pointFromName(9, 'E5');
    // White to move: Black's stone is the opponent's.
    expect(marked(planes, 9, 1)).toEqual([]);
    expect(marked(planes, 9, 2)).toEqual([e5]);
    // Four liberties: none of the 1–3 liberty planes.
    expect([3, 4, 5].map((k) => marked(planes, 9, k))).toEqual([[], [], []]);
    // The last move.
    expect(marked(planes, 9, 9)).toEqual([e5]);
    // White's komi, from White's side, and situational superko.
    expect(globals[5]).toBeCloseTo(7.5 / 20);
    expect(globals[6]).toBe(1);
    expect(globals[7]).toBe(-0.5);
  });

  it('marks chains by liberties, and the point ko forbids', () => {
    const s = position(
      [
        '.XO..', //
        'XO.O.',
        '.XO..',
        '.....',
        '.....',
      ],
      'black',
    );
    // Black captures at C4 (the point between), making a ko.
    const r = play(s, pointFromName(5, 'C4'));
    if (!r.ok) throw new Error(r.reason);
    const { planes } = encode(r.state);
    const b4 = pointFromName(5, 'B4');
    expect(marked(planes, 5, 6)).toEqual([b4]);
    // The capturing stone has one liberty, the ko point.
    expect(marked(planes, 5, 3)).toContain(pointFromName(5, 'C4'));
  });

  it('records passes among the last five moves and a pass that would end play', () => {
    const s = pass(playAll(newGame(9), 'E5'));
    const { planes, globals } = encode(s);
    expect(globals.slice(0, 5)).toEqual([1, 0, 0, 0, 0]);
    expect(globals[14]).toBe(1);
    // Black's E5 was two moves ago, Black's own.
    expect(marked(planes, 9, 10)).toEqual([pointFromName(9, 'E5')]);
  });

  it('shows the area each side would score if play stopped now, as KataGo counts it', () => {
    // White to move: plane 18 is White's area, 19 Black's.
    const lone = encode(playAll(newGame(9), 'E5')).planes;
    expect(marked(lone, 9, 18)).toEqual([]);
    expect(marked(lone, 9, 19).length).toBe(81);
    // Empty points touching both colours are no one's; every stone counts for its colour.
    const facing = position(['X...O', 'X...O', 'X...O', 'X...O', 'X...O'], 'black');
    const { planes } = encode(facing);
    expect(marked(planes, 5, 18)).toEqual([0, 5, 10, 15, 20]);
    expect(marked(planes, 5, 19)).toEqual([4, 9, 14, 19, 24]);
  });

  it("counts a stone inside a group that can never be captured as that group's", () => {
    const s = position(['.XO.X', 'XXXXX', '.....', '.....', '.....'], 'black');
    const { planes } = encode(s);
    expect(area(s.board, 5).every((o) => o === BLACK)).toBe(true);
    expect(marked(planes, 5, 18).length).toBe(25);
    expect(marked(planes, 5, 19)).toEqual([]);
  });

  it("gives Black the komi as a debt, and the komi's parity wave", () => {
    const { globals } = encode(newGame(19));
    expect(globals[5]).toBeCloseTo(-7.5 / 20);
    // KataGo's wave for -7.5 on an odd board.
    expect(globals[18]).toBeCloseTo(-0.5);
    expect(encode(playAll(newGame(9), 'E5')).globals[18]).toBeCloseTo(0.5);
  });
});

describe('read', () => {
  it('turns logits into probabilities, win chance and lead', () => {
    const r = read(3, outputs(3, { 4: 2 }, 0, [1, -1, -20], 6));
    const sum = r.policy.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
    expect(r.policy.length).toBe(10);
    expect(r.policy[4]).toBeGreaterThan(r.policy[9]);
    expect(r.win).toBeCloseTo(Math.exp(1) / (Math.exp(1) + Math.exp(-1)));
    expect(r.lead).toBeCloseTo(6);
  });
});

describe('decide', () => {
  it('plays the most likely move', () => {
    const s = newGame(9);
    const e5 = pointFromName(9, 'E5');
    expect(decide(s, read(9, outputs(9, { [e5]: 5, 3: 4 })))).toMatchObject({ kind: 'play', point: e5 });
  });

  it('skips an illegal favourite for the next legal move', () => {
    const s = playAll(newGame(9), 'E5');
    const e5 = pointFromName(9, 'E5');
    expect(decide(s, read(9, outputs(9, { [e5]: 5, 3: 4 })))).toMatchObject({ kind: 'play', point: 3 });
  });

  describe('passing first', () => {
    // Black to move on 5×5 owns columns A–C, White D–E.
    const blacks = (size: number) => new Array(size * size).fill(0).map((_, p) => (p % size < 3 ? 5 : -5));

    it('plays on while the board is open, though the network likes passing, as it does far ahead', () => {
      const ahead = new Array(81).fill(3);
      expect(decide(newGame(9), read(9, outputs(9, { 40: 1 }, 3, undefined, 0, ahead)))).toMatchObject({ kind: 'play', point: 40 });
    });

    it("passes once every point is one side's", () => {
      const settled = position(['X.XO.', 'X.XO.', 'X.XO.', 'X.XO.', 'X.XO.'], 'black');
      expect(decide(settled, read(5, outputs(5, { 1: 2.5 }, 3, undefined, 0, blacks(5))))).toMatchObject({ kind: 'pass' });
    });

    it('captures a dead stone in its area first', () => {
      const deadInside = position(['X.XO.', 'X.XO.', 'XOXO.', 'X.XO.', 'X.XO.'], 'black');
      expect(decide(deadInside, read(5, outputs(5, { 6: 2.5 }, 3, undefined, 0, blacks(5))))).toMatchObject({ kind: 'play', point: 6 });
    });

    it('never fills its own eye just to avoid passing', () => {
      // B4 is an eye in Black's wall; the bottom of the board is still open.
      const open = position(['XX.O.', 'X.XO.', 'XXXO.', '.....', '.....'], 'black');
      const own = blacks(5);
      const eye = pointFromName(5, 'B4');
      const d = decide(open, read(5, outputs(5, { [eye]: 2, 24: 1 }, 3, undefined, 0, own)));
      expect(d).toMatchObject({ kind: 'play', point: 24 });
    });

    it("passes when the points left between the sides are no one's, as in a seki", () => {
      const seki = position(['X.XO.', 'X.XO.', 'XX.O.', 'X.XO.', 'X.XO.'], 'black');
      const own = blacks(5).map((v, p) => (p === 12 ? 0 : v));
      expect(decide(seki, read(5, outputs(5, { 12: 1 }, 3, undefined, 0, own)))).toMatchObject({ kind: 'pass' });
    });
  });

  describe('after the opponent passes', () => {
    const passed = (rows: string[], komi = 7.5) => ({ ...position(rows, 'white', komi), consecutivePasses: 1 });

    it('passes too when it wins the count as the board stands', () => {
      // White: 10 stones, 5 points of territory and komi against Black's 10.
      const s = passed(['XXOO.', 'XXOO.', 'XXOO.', 'XXOO.', 'XXOO.']);
      expect(decide(s, read(5, outputs(5, { 4: 5 })))).toMatchObject({ kind: 'pass' });
    });

    it('plays on when it would lose the count', () => {
      const s = passed(['XXXXO', 'XXXXO', 'XXXXO', 'XXXXO', 'XXXX.']);
      expect(decide(s, read(5, outputs(5, { 24: 5 })))).toMatchObject({ kind: 'play', point: 24 });
    });

    it('counts the stones the network sees as dead as taken off, the way players mark them', () => {
      // Black's E3 sits in White's area: alive, Black wins by half a point; dead, White does.
      const rows = ['XX.OO', 'XX.OO', 'XX.OX', 'XX.OO', 'XX.OO'];
      const whites = new Array(25).fill(0).map((_, p) => (p % 5 >= 3 ? 5 : p % 5 < 2 ? -5 : 0));
      expect(decide(passed(rows, 0.5), read(5, outputs(5, { 2: 5 }, -20, undefined, 0, whites)))).toMatchObject({ kind: 'pass' });
      const alive = whites.map((v, p) => (p === 14 ? -5 : v));
      expect(decide(passed(rows, 0.5), read(5, outputs(5, { 2: 5 }, -20, undefined, 0, alive)))).toMatchObject({ kind: 'play', point: 2 });
    });
  });

  it('resigns only late in a game it is far behind in', () => {
    const lost = outputs(9, { 0: 5 }, -20, [-20, 5, -20], -30);
    const early = newGame(9);
    expect(decide(early, read(9, lost)).kind).toBe('play');
    const late = { ...early, moves: Array.from({ length: 41 }, () => ({ color: 'black' as const, kind: 'pass' as const })) };
    expect(decide(late, read(9, lost)).kind).toBe('resign');
    // Behind, but not by enough to give up against a beginner.
    expect(decide(late, read(9, outputs(9, { 0: 5 }, -20, [-20, 5, -20], -5))).kind).toBe('play');
  });

  describe('weaker levels', () => {
    // A flat favourite among a few good ideas, and junk the network barely considers.
    const spread = (size: number) =>
      outputs(size, { [pointFromName(size, 'E5')]: 3, [pointFromName(size, 'C3')]: 2.6, [pointFromName(size, 'G7')]: 2.4, 0: -6 });
    const moves = (level: number, size = 9) => {
      const seen = new Set<number>();
      let s = newGame(size);
      // Different positions with the same ideas: Black's and White's stones far from them.
      for (const far of ['A9', 'J9', 'A8', 'J8', 'B9', 'H9', 'B8', 'H8', 'C9', 'G9']) {
        const d = decide(s, read(size, spread(size)), level);
        if (d.kind === 'play') seen.add(d.point);
        s = playAll(s, far);
      }
      return seen;
    };

    it('the strongest level always plays the favourite', () => {
      expect([...moves(7)]).toEqual([pointFromName(9, 'E5')]);
    });

    it('a weaker level sometimes plays another good idea, never junk', () => {
      const seen = moves(3);
      expect(seen.size).toBeGreaterThan(1);
      expect(seen.has(0)).toBe(false);
    });

    it('the gentlest level often plays a move the network barely likes, though never one it ignores', () => {
      const seen = moves(1);
      const ideas = ['E5', 'C3', 'G7'].map((n) => pointFromName(9, n));
      expect([...seen].some((p) => !ideas.includes(p))).toBe(true);
      expect(seen.has(0)).toBe(false);
    });

    it('chooses the same move whenever it meets the same position', () => {
      const s = playAll(newGame(9), 'A9');
      const pick = () => decide(s, read(9, spread(9)), 2);
      expect(pick()).toEqual(pick());
    });

    it('still passes when the network likes passing best and the board is settled', () => {
      const settled = position(['X.XO.', 'X.XO.', 'X.XO.', 'X.XO.', 'X.XO.'], 'black');
      const own = new Array(25).fill(0).map((_, p) => (p % 5 < 3 ? 5 : -5));
      expect(decide(settled, read(5, outputs(5, { 1: 2.5 }, 3, undefined, 0, own)), 2)).toMatchObject({ kind: 'pass' });
    });
  });
});

describe('deadFromNet', () => {
  it("suggests the chains the network sees in the other side's area as dead, and doubtful ones as unsure", () => {
    // White to move after two passes; Black's lone B3 sits in White's area, and C1 is anyone's guess.
    const s = { ...position(['..OO.', '..O..', '.XO..', '..O..', '..OX.'], 'white'), phase: 'scoring' as const };
    // White's view: + is White's.
    const own = new Array(25).fill(0).map((_, p) => (p === pointFromName(5, 'D1') ? -0.1 : 5));
    const { dead, unsure } = deadFromNet(s, read(5, outputs(5, {}, -20, undefined, 0, own)));
    expect(dead).toEqual([pointFromName(5, 'B3')]);
    expect(unsure).toEqual([pointFromName(5, 'D1')]);
  });
});
