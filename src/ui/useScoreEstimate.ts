import { useEffect, useRef, useState } from 'react';
import { Playouts, projectScore, Projection } from '../go/ai';
import { GameState } from '../go/rules';

/** Enough playouts for a steady estimate, few enough to finish within a second or two on a phone. */
const estimatePlayouts = (size: number) => (size <= 9 ? 300 : size <= 13 ? 150 : 100);
/** Each slice of playouts stops after this long, so the board stays smooth while the estimate runs. */
const SLICE_MS = 12;

/**
 * Where the game seems headed while it is played, worked out from random playouts after every move.
 * The last estimate stays shown until the next one is ready, however many moves were played meanwhile,
 * and each new one keeps the previous one's squares where the playouts still roughly agree.
 * `gameKey` tells games apart, so another game never shows this one's estimate. While `paused` (the bot
 * thinking, which needs the same thread) nothing new is worked out and the last estimate stays shown.
 * Null when off, once play has ended, or before a game's first estimate.
 */
export function useScoreEstimate(game: GameState, enabled: boolean, gameKey: unknown, paused = false): Projection | null {
  const [projection, setProjection] = useState<{ key: unknown; value: Projection } | null>(null);
  const latest = useRef(projection);
  latest.current = projection;
  const on = enabled && game.phase === 'playing';
  useEffect(() => {
    if (!on || paused) return;
    const last = latest.current;
    const previous = last && last.key === gameKey ? last.value.owner : undefined;
    const p = new Playouts(game, { playouts: estimatePlayouts(game.size) });
    let timer: ReturnType<typeof setTimeout>;
    const slice = () => {
      const until = Date.now() + SLICE_MS;
      while (!p.finished && Date.now() < until) p.run(4);
      if (p.finished) setProjection({ key: gameKey, value: projectScore(p, previous) });
      else timer = setTimeout(slice, 0);
    };
    timer = setTimeout(slice, 0);
    return () => clearTimeout(timer);
  }, [game, on, gameKey, paused]);
  return on && projection && projection.key === gameKey ? projection.value : null;
}
