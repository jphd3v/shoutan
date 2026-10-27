import { HUMAN_META, humanMeta, humanStyleAt, withHumanMoves } from '../human';
import { BOT_LEVELS } from '../session';
import { NetReading } from '../katago';

const near = (a: ArrayLike<number>, b: number[]) => b.forEach((x, i) => expect(a[i]).toBeCloseTo(x, 5));

describe('the human-style network’s profile', () => {
  // Reference values from KataGo's python/katago/game/sgfmetadata.py for the profile rank_20k on 9×9.
  it('describes a game between two 20 kyu players on KGS as KataGo does', () => {
    const row = humanMeta(29, 9);
    expect(row).toHaveLength(HUMAN_META);
    expect(Array.from(row.slice(0, 6))).toEqual([1, 1, 0, 0, 0, 0]);
    expect(Array.from(row.slice(6, 74)).filter((x) => x === 1)).toHaveLength(58);
    near(row.slice(74, 90), [0.5, 0, 0, 0, 0, 1, 0, 0, 0.255547, 0.130196, 0.222955, -0.201713, -0.747214, -0.900969, 0.433884, -0.997553]);
    near(
      row.slice(140, 155),
      [0.955085, 0.635369, 0.772209, 0.817928, 0.57532, 0.910673, 0.413128, 0.956543, 0.29159, 0.978944, 0.204128, 0, 0, 1, 0],
    );
  });

  it('marks one rank step per stronger rank, for both players', () => {
    const weak = humanMeta(29, 19);
    const strong = humanMeta(10, 19);
    expect(Array.from(weak.slice(6, 40)).filter((x) => x === 1)).toHaveLength(29);
    expect(Array.from(strong.slice(40, 74)).filter((x) => x === 1)).toHaveLength(10);
    expect(weak[86]).toBe(0);
  });
});

describe('the human-style levels', () => {
  it('play every level, weakest first, the stronger ones imitating 10 kyu to 5 dan', () => {
    for (const size of [9, 13, 19]) {
      const human = BOT_LEVELS.map((level) => humanStyleAt(size, level)!);
      expect(human.every((s) => s !== null)).toBe(true);
      expect(human.slice(3).map((s) => s.inverse)).toEqual([19, 14, 10, 5]);
      human.slice(1).forEach((s, i) => {
        expect(s.inverse).toBeLessThanOrEqual(human[i].inverse);
        if (s.inverse === human[i].inverse) expect(s.heat).toBeLessThan(human[i].heat);
      });
    }
  });

  it('take the move from the human network and the judgement from the small one', () => {
    const judge: NetReading = { policy: Float64Array.of(1, 0), win: 0.7, lead: 3, ownership: Float64Array.of(0.9) };
    const human: NetReading = { policy: Float64Array.of(0, 1), win: 0.1, lead: -9, ownership: Float64Array.of(-0.9) };
    expect(withHumanMoves(judge, human)).toEqual({ ...judge, policy: human.policy });
  });
});
