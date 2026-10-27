import { RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { Color, colorOf, GameState, other, Stone as StoneValue } from '../../go/rules';
import { Slide, Stone } from '../Stone';
import { SLIDE_MS, stoneMotion } from '../stoneMotion';
import type { Spot } from './geometry';

/** How long removed stones take to shrink away (a new game). */
const VANISH_MS = 320;
/** Captured stones first lift, then fly to the captor's card; an undo plays the same path backwards. */
const LIFT_MS = 160;
const FLY_MS = 520;
/** When the first captured stone reaches its card, so the count there can change on arrival. */
export const CAPTURE_LAND_MS = LIFT_MS + FLY_MS;

/** An undone or redone stone slides this far, in points, from its player's side of the board. */
const SLIDE_POINTS = 1.8;
/** How far it goes toward the player's right (as a right hand takes it back), relative to going straight. */
const SLIDE_SIDEWAYS = 0.6;

type Exit =
  { kind: 'vanish' } | { kind: 'lift'; home: Spot | null; marked: boolean } | { kind: 'fly'; dx: number; dy: number; back: boolean };

const exitMs = (e: { kind: Exit['kind'] }) => (e.kind === 'fly' ? LIFT_MS + FLY_MS : e.kind === 'lift' ? SLIDE_MS : VANISH_MS);

/**
 * How the stones move from the last board to this one, worked out during the render that shows the
 * change, so new stones mount already sliding in and moved stones never flash in their end state. The card
 * positions are taken once here: a later render mid-flight must not restart a flight. `boardPage` is the
 * board's position on the page; `captureTarget` where each colour's captured stones fly to.
 */
export function useStoneMotion({
  game,
  still,
  redone,
  captureTarget,
  boardPage,
  at,
  cell,
}: {
  game: GameState;
  still: boolean;
  redone: boolean;
  captureTarget?: (captor: Color) => Spot | null;
  boardPage: RefObject<Spot>;
  at: (i: number) => number;
  cell: number;
}) {
  const n = game.size;
  const previous = useRef(game);
  const targetFor = useRef(captureTarget);
  targetFor.current = captureTarget;
  useLayoutEffect(() => {
    previous.current = game;
  }, [game]);
  const motions = useRef(0);
  const motion = useMemo(() => {
    const m = still ? null : stoneMotion(previous.current, game);
    if (!m) return null;
    const board = { ...boardPage.current };
    const cardOf = (c: Color): Spot | null => {
      const to = targetFor.current?.(c);
      return to ? { x: to.x - board.x, y: to.y - board.y } : null;
    };
    const fly = (v: { p: number; s: StoneValue }, back: boolean) => {
      const to = cardOf(other(colorOf(v.s)));
      return to ? { kind: 'fly' as const, back, dx: to.x, dy: to.y } : null;
    };
    // Without a measured card, a captured stone shrinks away and a returning one just appears.
    const moving = [
      ...m.vanished.map((v) => ({ ...v, delay: 0, exit: { kind: 'vanish' } as const })),
      // The newest undone move lifts first, taking the last-move ring with it.
      ...m.lifted.map((v, i) => ({ ...v, exit: { kind: 'lift', home: cardOf(colorOf(v.s)), marked: i === 0 } as const })),
      ...m.captured.map((v) => ({ ...v, exit: fly(v, false) ?? ({ kind: 'vanish' } as const) })),
      ...m.returned.flatMap((v) => {
        const exit = fly(v, true);
        return exit ? [{ ...v, exit }] : [];
      }),
    ];
    // Stones being set down animate on their own; only the stones drawn over the board need clearing away.
    const ms = Math.max(0, ...moving.map((v) => v.delay + exitMs(v.exit)));
    const placed = new Map(m.placed.map((v) => [v.p, { delay: v.delay, home: redone ? cardOf(colorOf(game.board[v.p])) : undefined }]));
    return { id: ++motions.current, placed, moving, ms };
  }, [game, still, redone, boardPage]);
  const [settled, setSettled] = useState<typeof motion>(null);
  useEffect(() => {
    if (!motion?.ms) return;
    const timer = setTimeout(() => setSettled(motion), motion.ms + 80);
    return () => clearTimeout(timer);
  }, [motion]);
  const live = motion && settled !== motion ? motion : null;
  // Undo lifts a stone back toward its player's side, and redo slides it in from there: below the board
  // for the player at the phone, above it for the bot or the player across the table, and on that player's right.
  const slide = (p: number, home: Spot | null, delay: number, away = false): Slide => {
    const side = home && home.y < at(Math.floor(p / n)) ? -1 : 1;
    const k = (cell * SLIDE_POINTS) / Math.hypot(SLIDE_SIDEWAYS, 1);
    return { delay, dx: side * SLIDE_SIDEWAYS * k, dy: side * k, away };
  };
  // Captured stones flying back hide the real stone until they land on it.
  const arriving = new Set(live?.moving.filter((v) => v.exit.kind === 'fly' && v.exit.back).map((v) => v.p));
  return { live, slide, arriving };
}

/**
 * A removed stone drawn over the board while it goes. Captured stones lift and fly by (`dx`, `dy`) to
 * the captor's card, or with `back` fly in from it to their point; other removals shrink away in place.
 */
export function Moving({
  color,
  size,
  exit,
  delay,
}: {
  color: 'black' | 'white';
  size: number;
  exit: Exclude<Exit, { kind: 'lift' }>;
  delay: number;
}) {
  // 0 is the stone on its point; for a flight 1 is lifted and 2 is at the card.
  const back = exit.kind === 'fly' && exit.back;
  const t = useRef(new Animated.Value(back ? 2 : 0)).current;
  const { kind } = exit;
  useEffect(() => {
    const step = (toValue: number, duration: number, easing: (v: number) => number) =>
      Animated.timing(t, { toValue, duration, easing, useNativeDriver: true });
    const path =
      kind !== 'fly'
        ? [step(2, VANISH_MS, Easing.linear)]
        : back
          ? [step(1, FLY_MS, Easing.inOut(Easing.cubic)), step(0, LIFT_MS, Easing.in(Easing.quad))]
          : [step(1, LIFT_MS, Easing.out(Easing.quad)), step(2, FLY_MS, Easing.inOut(Easing.cubic))];
    const move = Animated.sequence([Animated.delay(delay), ...path]);
    move.start();
    return () => move.stop();
  }, [t, kind, back, delay]);
  const style =
    exit.kind === 'fly'
      ? {
          opacity: t.interpolate({ inputRange: [0, 1.8, 2], outputRange: [1, 1, 0] }),
          transform: [
            { translateX: t.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, exit.dx] }) },
            { translateY: t.interpolate({ inputRange: [0, 1, 2], outputRange: [0, -size * 0.25, exit.dy] }) },
            { scale: t.interpolate({ inputRange: [0, 1, 2], outputRange: [1, 1.18, 0.55] }) },
          ],
        }
      : {
          opacity: t.interpolate({ inputRange: [0, 2], outputRange: [1, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 2], outputRange: [1, 0.4] }) }],
        };
  // Fills the point's slot so the stone scales and moves around its own centre.
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.centred, style]}>
      <Stone color={color} size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centred: { alignItems: 'center', justifyContent: 'center' },
});
