/**
 * The position on the cover's window: Lee Sedol (white) against AlphaGo (black), game 4 of their 2016 match,
 * which Lee won. Rows run from the 19th line down to the first; columns A to T skip I.
 */
const ROWS = [
  '...................',
  '....X...O.O..X.....',
  '...X.X.X.OXOOX.....',
  '..X.XOXXO.X.XX.X.X.',
  '....OOOXO...XOX...X',
  '...X.OXXO..XOOX.XXO',
  '.OOXOOXX.O..XO.XOOO',
  'XXXOOXO.OOXXXOX.XO.',
  'O.O.OXO.OX.XO.OOO..',
  '.OOOXX.XOXXOOO..OOO',
  'OXXX.XXOO.X.OOO....',
  '.OX..XO..OX.XO.OOOO',
  '......O.X.X...O....',
  '.XXXX..OX..........',
  '..O.OOOX......XO...',
  '.O.OXO.O.O..X.X.O..',
  '..O..O..X....XOO...',
  '....OXX.......XXO..',
  '...OX...........XO.',
];

export const SIZE = 19;
export type Owner = 'black' | 'white';
export interface Stone {
  x: number;
  y: number;
  color: Owner;
}
/** A point of the board with the shade it is painted and when, from 0 to 1 of the painting, it starts. */
export interface Patch {
  x: number;
  y: number;
  owner: Owner;
  strength: number;
  start: number;
}

export const stones: Stone[] = ROWS.flatMap((row, y) =>
  [...row].flatMap((c, x) => (c === '.' ? [] : [{ x, y, color: (c === 'X' ? 'black' : 'white') as Owner }])),
);

/** A small seeded generator, so the painting is the same every time. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Who each point belongs to by the stones' reach, with some noise so the edges come out ragged like brush strokes. */
export function paint(seed = 4): Patch[] {
  const random = seeded(seed);
  const patches: Patch[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let black = 0;
      let white = 0;
      let nearest = Infinity;
      for (const s of stones) {
        const d2 = (s.x - x) ** 2 + (s.y - y) ** 2;
        const reach = Math.exp(-d2 / 9);
        if (s.color === 'black') black += reach;
        else white += reach;
        nearest = Math.min(nearest, Math.sqrt(d2));
      }
      const lean = (black - white) / (black + white + 0.05);
      const owner: Owner = lean + (random() - 0.5) * 0.6 >= 0 ? 'black' : 'white';
      patches.push({
        x,
        y,
        owner,
        strength: Math.min(1, 0.7 + 0.25 * Math.abs(lean) + random() * 0.1),
        start: 0.5 * random() + 0.5 * Math.min(1, nearest / 5),
      });
    }
  }
  return patches;
}
