/** The wooden edge below the board face, in dp. */
export const BOARD_EDGE = 6;

/** A position relative to the board's top-left corner. */
export type Spot = { x: number; y: number };

/** Distance from the outer grid line to the board edge, in cells: room for coordinates, or a slim rim. */
const marginFor = (coordinates: boolean, n: number) => (coordinates ? 1.25 : n > 13 ? 0.7 : 0.55);

/** Where the grid of an `n`×`n` board sits on a face `width` dp wide: `at(i)` is the i-th line's offset. */
export function boardGeometry(width: number, n: number, coordinates: boolean) {
  const margin = marginFor(coordinates, n);
  const cell = width / (n - 1 + 2 * margin);
  const origin = cell * margin;
  return { cell, origin, span: cell * (n - 1), at: (i: number) => origin + i * cell };
}

export function starPoints(size: number): number[] {
  const lines = size === 9 ? [2, 6] : size === 13 ? [3, 9] : size === 19 ? [3, 9, 15] : [];
  const pts: number[] = [];
  for (const r of lines) for (const c of lines) pts.push(r * size + c);
  // 19×19's lines already cross at the centre.
  const centre = ((size - 1) / 2) * (size + 1);
  if (size % 2 === 1 && !pts.includes(centre)) pts.push(centre);
  return pts;
}
