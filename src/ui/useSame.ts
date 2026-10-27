import { useRef } from 'react';

/**
 * The previous value while the new one is equal to it, so a memoised child such as the board
 * redraws only when what it shows changes. For small plain data that is rebuilt on each render.
 */
export function useSame<T>(value: T): T {
  const kept = useRef(value);
  if (JSON.stringify(kept.current) !== JSON.stringify(value)) kept.current = value;
  return kept.current;
}
