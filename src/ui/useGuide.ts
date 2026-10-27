import { useEffect, useMemo, useRef, useState } from 'react';
import { allLiberties, momentsAfter } from '../go/guide';
import { GameState } from '../go/rules';
import { momentText } from './copy';

/** A Guide message on the board, over the stones it is about. */
export interface GuideNote {
  id: number;
  label: string;
  points: readonly number[];
}

/** Long enough for a child to read a short sentence after it has floated above the board. */
const NOTE_MS = 3600;

/**
 * What the Guide shows for a game from the rules alone; the Coach's ideas come from the network (`useNetHints`).
 * With `teaching`: a note after a move that takes a ko; a plain capture or atari shows on the board by
 * itself. With `showLiberties`: every liberty on the board.
 */
export function useGuide(game: GameState, teaching: boolean, showLiberties: boolean) {
  const previous = useRef(game);
  const [note, setNote] = useState<GuideNote | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = game;
    if (!teaching) return;
    const moment = momentsAfter(before, game)[0];
    if (!moment) return;
    setNote((n) => ({
      id: (n?.id ?? 0) + 1,
      label: momentText(moment),
      points: moment.points,
    }));
  }, [game, teaching]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const liberties = useMemo(() => (showLiberties && game.phase === 'playing' ? allLiberties(game) : []), [game, showLiberties]);

  return { note: teaching ? note : null, liberties, holdLiberties: teaching || showLiberties };
}
