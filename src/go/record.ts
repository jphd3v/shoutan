import { GameState, pointName } from './rules';

/** A one-line game record for bug reports, e.g. "9x9 komi 7.5, playing: B E5, W C3, B pass" or "9x9 handicap 3 komi 3.5, …". */
export function gameRecord(g: GameState): string {
  const moves = g.moves.map((m) => {
    const who = m.color === 'black' ? 'B' : 'W';
    if (m.kind === 'pass') return `${who} pass`;
    if (m.kind === 'resign') return `${who} resigns`;
    return `${who} ${pointName(g.size, m.point)}${m.captured ? ` x${m.captured}` : ''}`;
  });
  const setup = g.handicap ? ` handicap ${g.handicap}` : '';
  return `${g.size}x${g.size}${setup} komi ${g.komi}, ${g.phase}: ${moves.join(', ') || 'no moves'}`;
}
