import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY, isLegal } from '../go/rules';
import { haptic } from '../ui/haptics';
import type { ShownGame } from './shownGame';

/**
 * What a tap on the board does, for whichever game is on screen. With `needsConfirm` a legal move is first
 * a preview and a second tap on it places it; any other tap the game takes (`tapMode`) goes to it and clears
 * the preview. The preview also clears whenever the game changes. `onTap` keeps its identity, so the
 * memoised board isn't redrawn for it.
 */
export function useMoveInput({ shown, needsConfirm }: { shown: ShownGame; needsConfirm: boolean }) {
  const [preview, setPreview] = useState<number | null>(null);
  useEffect(() => setPreview(null), [shown.game]);
  const latest = useRef({ shown, needsConfirm, preview });
  latest.current = { shown, needsConfirm, preview };
  const onTap = useCallback((p: number) => {
    const { shown: s, needsConfirm: confirm, preview: shownPreview } = latest.current;
    const { game } = s;
    if (s.tapMode === 'ignore') return;
    if (s.tapMode === 'play' && game.phase === 'playing' && confirm && game.board[p] === EMPTY && isLegal(game, p) && shownPreview !== p) {
      setPreview(p);
      void haptic('tick');
      return;
    }
    setPreview(null);
    s.tap(p);
  }, []);
  return { preview, onTap };
}
