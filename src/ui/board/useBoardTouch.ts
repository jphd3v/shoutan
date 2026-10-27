import { useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, View, ViewProps } from 'react-native';
import { Color, EMPTY, GameState } from '../../go/rules';
import { haptic } from '../haptics';
import type { Spot } from './geometry';

/** How long a finger rests on a stone before its liberties show. */
const HOLD_MS = 350;
/** Without a confirming tap, how long a finger rests on an empty point before the aiming stone shows. */
const AIM_REST_MS = 180;

/**
 * The board's touch handling. The board view is the only touch responder: a tap places where the finger
 * lifts. With `aimColor` set, the point under the finger is aimed: at once with `aimAtOnce`, otherwise
 * once the finger slides or rests, so a quick tap shows no flash. With `showLiberties`, resting on a
 * stone holds it, and lifting it then places nothing. Spread `responder` on the board view.
 */
export function useBoardTouch({
  game,
  origin,
  cell,
  aimColor,
  aimAtOnce,
  showLiberties,
  onTap,
}: {
  game: GameState;
  origin: number;
  cell: number;
  aimColor: Color | null;
  aimAtOnce: boolean;
  showLiberties: boolean;
  onTap: (point: number) => void;
}) {
  const n = game.size;
  // Touch positions come from page coordinates: on Android `locationX/Y` is
  // relative to whichever view is under the finger, not reliably the board.
  const boardRef = useRef<View>(null);
  const boardPage = useRef<Spot>({ x: 0, y: 0 });

  const pointFromPage = (pageX: number, pageY: number): number | null => {
    const fx = (pageX - boardPage.current.x - origin) / cell;
    const fy = (pageY - boardPage.current.y - origin) / cell;
    const c = Math.round(fx);
    const r = Math.round(fy);
    if (c < 0 || r < 0 || c >= n || r >= n || Math.abs(fx - c) > 0.6 || Math.abs(fy - r) > 0.6) return null;
    return r * n + c;
  };
  const pointAt = (e: GestureResponderEvent) => pointFromPage(e.nativeEvent.pageX, e.nativeEvent.pageY);

  // The finger covers the stone it aims, so the guide lines reach past it on both sides.
  const [aim, setAim] = useState<number | null>(null);
  const aimAt = (p: number | null) => {
    if (p === aim) return;
    setAim(p);
    if (p !== null && game.board[p] === EMPTY) void haptic('tick');
  };
  // Where the finger is and where it landed, for aiming that waits for a drag or a rest.
  const finger = useRef<{ start: number | null; at: number | null; aiming: boolean }>({ start: null, at: null, aiming: false });
  const aimTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(aimTimer.current), []);
  const follow = (p: number | null, landing = false) => {
    if (!aimColor) return;
    const f = finger.current;
    if (landing) {
      finger.current = { start: p, at: p, aiming: aimAtOnce };
      clearTimeout(aimTimer.current);
      if (aimAtOnce) aimAt(p);
      else
        aimTimer.current = setTimeout(() => {
          finger.current.aiming = true;
          aimAt(finger.current.at);
        }, AIM_REST_MS);
      return;
    }
    f.at = p;
    if (!f.aiming && p !== f.start) {
      clearTimeout(aimTimer.current);
      f.aiming = true;
    }
    if (f.aiming) aimAt(p);
  };
  const stopAim = () => {
    clearTimeout(aimTimer.current);
    finger.current = { start: null, at: null, aiming: false };
    setAim(null);
  };

  // Resting a finger on a stone shows its group's liberties; lifting it then places nothing.
  const [held, setHeld] = useState<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const holdPoint = useRef<number | null>(null);
  const wasHeld = useRef(false);
  useEffect(() => () => clearTimeout(holdTimer.current), []);
  const holdAt = (p: number | null) => {
    if (p === holdPoint.current) return;
    holdPoint.current = p;
    clearTimeout(holdTimer.current);
    setHeld(null);
    if (!showLiberties || p === null || game.board[p] === EMPTY) return;
    holdTimer.current = setTimeout(() => {
      wasHeld.current = true;
      setHeld(p);
      void haptic('tick');
    }, HOLD_MS);
  };
  const endHold = () => {
    clearTimeout(holdTimer.current);
    holdPoint.current = null;
    setHeld(null);
  };

  const responder: ViewProps = {
    onLayout: () =>
      boardRef.current?.measure((_x, _y, _w, _h, px, py) => {
        boardPage.current = { x: px, y: py };
      }),
    onStartShouldSetResponder: () => true,
    onResponderGrant: (e) => {
      const { pageX, pageY } = e.nativeEvent;
      wasHeld.current = false;
      holdPoint.current = null;
      follow(pointAt(e), true);
      holdAt(pointAt(e));
      // Refresh the board position in case the layout moved since it was measured.
      boardRef.current?.measure((_x, _y, _w, _h, px, py) => {
        boardPage.current = { x: px, y: py };
        follow(pointFromPage(pageX, pageY), true);
        holdAt(pointFromPage(pageX, pageY));
      });
    },
    onResponderMove: (e) => {
      follow(pointAt(e));
      holdAt(pointAt(e));
    },
    // While aiming, keep the finger even if it drifts; otherwise a scroll view may take it.
    onResponderTerminationRequest: () => !(aimColor && finger.current.aiming),
    onResponderRelease: (e) => {
      const p = pointAt(e) ?? aim;
      stopAim();
      endHold();
      if (wasHeld.current) return;
      if (p !== null) onTap(p);
    },
    onResponderTerminate: () => {
      stopAim();
      endHold();
    },
  };

  const aiming = aimColor !== null && aim !== null && game.board[aim] === EMPTY;
  return { boardRef, boardPage, responder, aim: aiming ? aim : null, held };
}
