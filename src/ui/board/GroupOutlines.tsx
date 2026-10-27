import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import type { GroupStatus, StatusGroup } from '../../go/netHints';
import { pointName } from '../../go/rules';
import { colors } from '../theme';

/**
 * How each outline of the Coach looks, shared with the legend. Red is the board's colour for stones
 * in danger (as on dead-stone crosses): a solid line round stones that can still be saved, dashes round
 * stones likely lost. Violet, for stones whose fate is open, stands out from the wood.
 * Widths are shares of a cell.
 */
export const OUTLINE_LOOK: Record<GroupStatus, { stroke: string; width: number; dashed: boolean }> = {
  urgent: { stroke: colors.danger, width: 0.05, dashed: false },
  lost: { stroke: colors.danger, width: 0.05, dashed: true },
  weak: { stroke: colors.open, width: 0.06, dashed: true },
};
/** Dash and gap, as shares of a cell. */
export const OUTLINE_DASH = [0.12, 0.14];

type Pt = readonly [number, number];
const left = ([dx, dy]: Pt): Pt => [dy, -dx];
const right = ([dx, dy]: Pt): Pt => [-dy, dx];
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/**
 * The outline of a chain's cells as closed loops of grid corners (corner (x, y) is the top-left of the
 * cell around point (x, y)), each walked with the chain on its left, with each corner's directions in and out.
 */
export function outlineLoops(stones: readonly number[], n: number): { at: Pt; in: Pt; out: Pt }[][] {
  const inChain = new Set(stones);
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && inChain.has(y * n + x);
  const edges: { from: Pt; dir: Pt; used: boolean }[] = [];
  for (const p of stones) {
    const x = p % n;
    const y = Math.floor(p / n);
    if (!has(x, y - 1)) edges.push({ from: [x + 1, y], dir: [-1, 0], used: false });
    if (!has(x, y + 1)) edges.push({ from: [x, y + 1], dir: [1, 0], used: false });
    if (!has(x - 1, y)) edges.push({ from: [x, y], dir: [0, 1], used: false });
    if (!has(x + 1, y)) edges.push({ from: [x + 1, y + 1], dir: [0, -1], used: false });
  }
  const from = new Map<string, typeof edges>();
  for (const e of edges) from.set(`${e.from}`, [...(from.get(`${e.from}`) ?? []), e]);
  const loops: { at: Pt; in: Pt; out: Pt }[][] = [];
  for (const start of edges) {
    if (start.used) continue;
    const walk: { from: Pt; dir: Pt }[] = [];
    let e: (typeof edges)[number] | undefined = start;
    while (e && !e.used) {
      e.used = true;
      walk.push(e);
      const d: Pt = e.dir;
      const end: Pt = [e.from[0] + d[0], e.from[1] + d[1]];
      const next: typeof edges = (from.get(`${end}`) ?? []).filter((c) => !c.used);
      // Where two cells of the chain meet only at a corner, turning left keeps to the cell being walked.
      e = next.find((c) => same(c.dir, left(d))) ?? next.find((c) => same(c.dir, d)) ?? next.find((c) => same(c.dir, right(d)));
    }
    const loop = walk.map((w, i) => ({ at: w.from, in: walk[(i + walk.length - 1) % walk.length].dir, out: w.dir }));
    loops.push(loop.filter((c) => !same(c.in, c.out)));
  }
  return loops;
}

/**
 * An SVG path for a chain's outline along its cells' edges, half a cell from each stone's centre. Outer
 * corners are rounded to that half cell, so a lone stone is ringed by a circle and a line of stones by a
 * capsule; inner corners get a smaller curve.
 */
export function outlinePath(stones: readonly number[], n: number, origin: number, cell: number): string {
  const f = (v: number) => v.toFixed(1);
  return outlineLoops(stones, n)
    .map(
      (loop) =>
        loop
          .map(({ at, in: a, out: b }, i) => {
            // The chain is on the left of the walk, so a left turn goes round an outer corner.
            const outer = same(b, left(a));
            const r = outer ? cell / 2 : cell * 0.2;
            const x = origin + (at[0] - 0.5) * cell;
            const y = origin + (at[1] - 0.5) * cell;
            const start = `${f(x - a[0] * r)} ${f(y - a[1] * r)}`;
            return `${i ? 'L' : 'M'}${start} A${f(r)} ${f(r)} 0 0 ${outer ? 0 : 1} ${f(x + b[0] * r)} ${f(y + b[1] * r)}`;
          })
          .join(' ') + ' Z',
    )
    .join(' ');
}

/**
 * The Coach's outlines: a line around each chain the network calls lost, urgent or weak, over
 * the stones. Memoised: the board re-renders on every finger move while aiming.
 */
export const GroupOutlines = memo(function GroupOutlines({
  outlines,
  n,
  origin,
  cell,
  width,
  height,
}: {
  outlines: readonly StatusGroup[];
  n: number;
  origin: number;
  cell: number;
  width: number;
  height: number;
}) {
  const dash = OUTLINE_DASH.map((d) => d * cell).join(' ');
  return (
    <Svg width={width} height={height} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {outlines.map((o) => {
        const look = OUTLINE_LOOK[o.status];
        const d = outlinePath(o.stones, n, origin, cell);
        const w = Math.max(1.5, look.width * cell);
        // Each status has its own key, so a chain changing status remounts rather than keeping a stale dash.
        const dashArray = look.dashed ? dash : undefined;
        return (
          <G key={`${o.status}-${o.stones[0]}`} testID={`outline-${o.status}-${pointName(n, o.stones[0])}`}>
            {/* A dark edge under the line, so it reads on the wood and on white stones alike. */}
            <Path d={d} fill="none" stroke={colors.noteEdge} strokeWidth={w + 2} strokeDasharray={dashArray} strokeLinecap="round" />
            <Path d={d} fill="none" stroke={look.stroke} strokeWidth={w} strokeDasharray={dashArray} strokeLinecap="round" />
          </G>
        );
      })}
    </Svg>
  );
});
