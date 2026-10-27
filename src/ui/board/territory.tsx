import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Region } from '../../go/count';
import { BLACK, EMPTY, GameState, WHITE } from '../../go/rules';
import { territoryTint } from '../theme';

/** A territory square's point and owner as one number. */
/** How each player's area looks at the end of the count: a glaze in their colour with a rim that sets it off the wood. */
const AREA_LOOK = {
  [BLACK]: { fill: '#0A0A0C', edge: '#8A8A90', opacity: 0.7 },
  [WHITE]: { fill: '#FFFFFF', edge: '#A89C88', opacity: 0.72 },
} as const;

/**
 * A smooth shape around a set of points, as pieces that together cover it: a disc of radius `r`
 * on each point, a band between neighbours in a row or column, and the square inside each fully
 * owned 2×2 block. With `r` at half a cell, two players' shapes meet without overlapping.
 */
function areaPaths(
  points: ReadonlySet<number>,
  n: number,
  where: (p: number) => readonly [number, number],
  cell: number,
  r: number,
): string[] {
  let discs = '';
  let bands = '';
  let blocks = '';
  for (const p of points) {
    const [x, y] = where(p);
    discs += `M${x - r} ${y}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0Z`;
    const right = p % n < n - 1 && points.has(p + 1);
    const down = p + n < n * n && points.has(p + n);
    if (right) bands += `M${x} ${y - r}H${x + cell}V${y + r}H${x}Z`;
    if (down) bands += `M${x - r} ${y}H${x + r}V${y + cell}H${x - r}Z`;
    if (right && down && points.has(p + n + 1)) blocks += `M${x} ${y}H${x + cell}V${y + cell}H${x}Z`;
  }
  return [discs, bands, blocks].filter(Boolean);
}

const NO_SHARED: readonly number[] = [];
const squareKey = (owner: number, p: number) => p * 3 + owner;

/** Fades a newly filled-in territory region in. */
function FadeIn({ children, still }: { children: ReactNode; still: boolean }) {
  const t = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) return;
    Animated.timing(t, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [t, still]);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: t }]}>
      {children}
    </Animated.View>
  );
}

interface Canvas {
  /** The board's size in dp, which each layer covers. */
  width: number;
  height: number;
  cell: number;
  /** Where the outer grid lines sit, from the board's edge. */
  origin: number;
}

const lineAt = (origin: number, cell: number) => (i: number) => origin + i * cell;

export interface CountedPoints {
  regions: readonly Region[];
  shared: readonly number[];
}

/** Each player's whole area, their stones and territory as one translucent shape over the board. */
export function AreaFills({
  game,
  territory,
  still,
  width,
  height,
  cell,
  origin,
}: Canvas & { game: GameState; territory: readonly Region[] | null; still: boolean }) {
  const n = game.size;
  const at = lineAt(origin, cell);
  return ([BLACK, WHITE] as const).map((owner) => {
    const own = new Set((territory ?? []).filter((r) => r.owner === owner).flatMap((r) => r.points));
    game.board.forEach((v, p) => v === owner && !game.dead.has(p) && own.add(p));
    if (!own.size) return null;
    const look = AREA_LOOK[owner];
    const where = (p: number) => [at(p % n), at(Math.floor(p / n))] as const;
    return (
      <FadeIn key={`area-${owner}`} still={still}>
        {/* Drawn opaque, then faded as one layer, so overlapping pieces don't darken each other. */}
        <View style={[StyleSheet.absoluteFill, { opacity: look.opacity }]} needsOffscreenAlphaCompositing>
          <Svg width={width} height={height} testID={`area-${owner === BLACK ? 'black' : 'white'}`}>
            {areaPaths(own, n, where, cell, cell * 0.5).map((d, i) => (
              <Path key={`edge-${i}`} d={d} fill={look.edge} />
            ))}
            {areaPaths(own, n, where, cell, cell * 0.42).map((d, i) => (
              <Path key={`fill-${i}`} d={d} fill={look.fill} />
            ))}
          </Svg>
        </View>
      </FadeIn>
    );
  });
}

/** A point's square, or half of it for each owner of a shared point. */
function squarePath(x: number, y: number, side: number, half?: 'left' | 'right'): string {
  const l = x - side / 2;
  const t = y - side / 2;
  if (half) return `M${half === 'left' ? l : x} ${t}h${side / 2}v${side}h${-side / 2}Z`;
  return `M${l} ${t}h${side}v${side}h${-side}Z`;
}

/** All points share two canvases: settled squares and newly counted squares fading in. */
export function TerritorySquares({
  game,
  territory,
  shared = NO_SHARED,
  ghostKey,
  still,
  width,
  height,
  cell,
  origin,
}: Canvas & { game: GameState; territory: readonly Region[] | null; shared?: readonly number[]; ghostKey: string; still: boolean }) {
  const n = game.size;
  const marking = game.phase === 'scoring';
  const squaresBefore = useRef<ReadonlySet<number>>(new Set());
  const squarePaths = useMemo(() => {
    if (!territory) return null;
    const ghost = new Set(ghostKey ? ghostKey.split(',').map(Number) : []);
    const side = cell * 0.4;
    const at = lineAt(origin, cell);
    const path = (p: number, half?: 'left' | 'right') => squarePath(at(p % n), at(Math.floor(p / n)), side, half);
    const layer = (fresh: boolean) =>
      ([BLACK, WHITE] as const).map((owner) => {
        const points = territory
          .filter((r) => r.owner === owner)
          .flatMap((r) => r.points)
          .filter((p) => !(marking && game.dead.has(p)) && !ghost.has(p) && squaresBefore.current.has(squareKey(owner, p)) !== fresh);
        const halves = shared.filter((p) => squaresBefore.current.has(squareKey(0, p)) !== fresh);
        return {
          owner,
          points: [...points, ...halves],
          d: points.map((p) => path(p)).join('') + halves.map((p) => path(p, owner === BLACK ? 'left' : 'right')).join(''),
        };
      });
    const fresh = layer(true);
    return { settled: layer(false), fresh, freshKey: fresh.map((l) => l.points.join()).join('|') };
  }, [territory, shared, ghostKey, marking, game.dead, cell, origin, n]);
  useEffect(() => {
    squaresBefore.current = new Set([
      ...(territory ?? []).flatMap((r) => r.points.map((p) => squareKey(r.owner, p))),
      ...shared.map((p) => squareKey(0, p)),
    ]);
  }, [territory, shared]);
  if (!squarePaths) return null;
  const squareLayer = (layer: { owner: number; d: string }[], fresh: boolean) => (
    <Svg width={width} height={height}>
      {layer.map(({ owner, d }) =>
        d ? (
          <Path
            key={owner}
            testID={`point-squares-${owner === BLACK ? 'black' : 'white'}-${fresh ? 'new' : 'kept'}`}
            d={d}
            fill={territoryTint(owner === BLACK ? 'black' : 'white')}
            fillOpacity={0.92}
            // A mid-grey rim sets a square off the wood and off a dead stone of either colour under it.
            stroke={owner === BLACK ? 'rgba(185, 185, 185, 0.95)' : 'rgba(125, 125, 125, 0.95)'}
            strokeWidth={2}
          />
        ) : null,
      )}
    </Svg>
  );
  return (
    <>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {squareLayer(squarePaths.settled, false)}
      </View>
      {squarePaths.freshKey !== '|' && (
        <FadeIn key={squarePaths.freshKey} still={still}>
          {squareLayer(squarePaths.fresh, true)}
        </FadeIn>
      )}
    </>
  );
}

/**
 * Points the estimate expects a player to win but not yet fenced in: a smaller, fainter square of their colour.
 * Memoised: the board re-renders on every finger move while aiming.
 */
export function ProjectedSquares({
  game,
  projected,
  territory,
  ghostKey,
  width,
  height,
  cell,
  origin,
}: Canvas & { game: GameState; projected: readonly number[] | null; territory: readonly Region[] | null; ghostKey: string }) {
  const n = game.size;
  const paths = useMemo(() => {
    if (!projected) return null;
    // Fenced-in points have their full square already; a ghost stone's point stays clear.
    const skip = new Set([...(territory ?? []).flatMap((r) => r.points), ...(ghostKey ? ghostKey.split(',').map(Number) : [])]);
    const s = cell * 0.3;
    const at = lineAt(origin, cell);
    return ([BLACK, WHITE] as const).map((owner) => ({
      owner,
      d: projected
        .flatMap((o, p) => (o === owner && game.board[p] === EMPTY && !skip.has(p) ? [p] : []))
        .map((p) => `M${at(p % n) - s / 2} ${at(Math.floor(p / n)) - s / 2}h${s}v${s}h${-s}Z`)
        .join(''),
    }));
  }, [projected, territory, ghostKey, game.board, cell, origin, n]);
  if (!paths) return null;
  return paths.map(({ owner, d }) =>
    d ? (
      <Svg key={`projected-${owner}`} width={width} height={height} pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Path
          d={d}
          fill={territoryTint(owner === BLACK ? 'black' : 'white')}
          fillOpacity={0.35}
          testID={`projected-${owner === BLACK ? 'black' : 'white'}`}
        />
      </Svg>
    ) : null,
  );
}
