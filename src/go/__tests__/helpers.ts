import { BLACK, Color, EMPTY, GameState, newGame, play, pointFromName, situationKey, Stone, WHITE } from '../rules';

/** Builds a position from rows of `X` (black), `O` (white) and `.` (empty). */
export function position(rows: string[], toPlay: Color = 'black', komi = 7.5): GameState {
  const size = rows.length;
  const board: Stone[] = rows
    .join('')
    .split('')
    .map((ch) => (ch === 'X' ? BLACK : ch === 'O' ? WHITE : EMPTY));
  if (board.length !== size * size) throw new Error('diagram must be square');
  return { ...newGame(size, komi), board, toPlay, seen: new Set([situationKey(board, toPlay)]) };
}

/** Plays moves given as coordinates like "D4", throwing on an illegal one. */
export function playAll(state: GameState, ...names: string[]): GameState {
  for (const name of names) {
    const r = play(state, pointFromName(state.size, name));
    if (!r.ok) throw new Error(`${name} rejected: ${r.reason}`);
    state = r.state;
  }
  return state;
}

export const at = (state: GameState, name: string) => state.board[pointFromName(state.size, name)];
