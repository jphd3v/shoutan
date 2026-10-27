import { outlineLoops, outlinePath } from '../board/GroupOutlines';

/** Each loop's corners, starting from the smallest so the starting corner doesn't matter. */
const corners = (stones: number[], n: number) =>
  outlineLoops(stones, n).map((loop) => {
    const names = loop.map((c) => c.at.join(','));
    const first = names.indexOf([...names].sort()[0]);
    return [...names.slice(first), ...names.slice(0, first)];
  });

describe('outlineLoops', () => {
  it('goes round a lone stone by its four corners, the stone on its left', () => {
    // Point (1, 1) on a 3×3: its cell's corners run from (1, 1) to (2, 2).
    expect(corners([4], 3)).toEqual([['1,1', '1,2', '2,2', '2,1']]);
  });

  it('goes round a line of stones by its four outer corners only', () => {
    expect(corners([0, 1, 2], 3)).toEqual([['0,0', '0,1', '3,1', '3,0']]);
  });

  it('a ring of stones has two loops: round the outside and round the hole', () => {
    const ring = [0, 1, 2, 3, 5, 6, 7, 8];
    const loops = corners(ring, 3);
    expect(loops).toHaveLength(2);
    expect(loops.map((l) => l.length).sort()).toEqual([4, 4]);
    expect(loops.find((l) => l.includes('1,1'))?.sort()).toEqual(['1,1', '1,2', '2,1', '2,2']);
  });

  it('where two cells of the chain meet only at a corner, each turn there keeps to its own cell', () => {
    // A ring round the centre missing the top-left point: (1, 0) and (0, 1) touch at corner (1, 1).
    const loops = outlineLoops([1, 2, 5, 8, 7, 6, 3], 3);
    const pinch = loops.flat().filter((c) => c.at.join(',') === '1,1');
    expect(pinch).toHaveLength(2);
    // Each turn there is a left turn hugging one cell, so the two turns run in opposite directions.
    expect(pinch.map((c) => `${c.in}>${c.out}`).sort()).toEqual(['0,-1>-1,0', '0,1>1,0']);
  });
});

describe('outlinePath', () => {
  it('rings a lone stone with four quarter circles of half a cell round its centre', () => {
    // Point (1, 1) on a 3×3 with 10 dp cells and the grid starting at 5 dp: the stone's centre is (15, 15).
    const d = outlinePath([4], 3, 5, 10);
    expect(d.match(/A5\.0 5\.0 0 0 0/g)).toHaveLength(4);
    // It starts on the right of the stone, level with its centre.
    expect(d.startsWith('M20.0 15.0')).toBe(true);
  });

  it('rounds an inner corner the other way, with a smaller curve', () => {
    // An L of three stones has one inner corner.
    const d = outlinePath([0, 3, 4], 3, 5, 10);
    expect(d.match(/A2\.0 2\.0 0 0 1/g)).toHaveLength(1);
    expect(d.match(/A5\.0 5\.0 0 0 0/g)).toHaveLength(5);
  });
});
