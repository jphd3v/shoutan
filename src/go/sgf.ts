/**
 * A small reader for SGF (Smart Game Format) game records, enough to replay a game through the
 * rules: board size, komi, result, setup stones and the main line of moves. Variations, comments
 * and other properties are skipped.
 */
import { BLACK, Color, EMPTY, GameState, newGame, pass, play, pointName, resumePlay, situationKey, Stone, WHITE } from './rules';

export interface SgfSetup {
  black: number[];
  white: number[];
  /** Points cleared (AE). */
  empty: number[];
}

export interface SgfMove {
  color: Color;
  /** Null for a pass. */
  point: number | null;
  /** Stones added or cleared in the nodes since the previous move, placed before this one. */
  setup?: SgfSetup;
}

export interface SgfGame {
  size: number;
  komi: number;
  /** From RE: the winner (null for a draw) and the margin (null for resignation, time and the like). */
  result: { winner: Color | null; margin: number | null } | null;
  /** Setup in the root node, e.g. handicap stones. */
  setup: SgfSetup;
  moves: SgfMove[];
}

type Node = Map<string, string[]>;

/** The nodes of the main line: at each branching, the first variation. */
function mainLine(text: string): Node[] {
  const start = text.indexOf('(');
  if (start < 0 || text.indexOf(';', start) < 0) throw new Error('Not an SGF game');
  const nodes: Node[] = [];
  let i = start;
  let node: Node | null = null;
  let ident = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '[') {
      let value = '';
      i++;
      while (i < text.length && text[i] !== ']') {
        if (text[i] === '\\') i++;
        value += text[i++] ?? '';
      }
      if (node && ident) node.set(ident, [...(node.get(ident) ?? []), value]);
    } else if (ch === ')') {
      // The first variation has ended; whatever follows is other variations.
      break;
    } else if (ch === ';') {
      node = new Map();
      nodes.push(node);
      ident = '';
    } else if (/[A-Za-z]/.test(ch)) {
      // Identifiers are upper case; old files may mix in lower-case letters, which are ignored.
      if (i === 0 || !/[A-Za-z]/.test(text[i - 1])) ident = '';
      if (/[A-Z]/.test(ch)) ident += ch;
    }
    i++;
  }
  return nodes;
}

function point(size: number, value: string): number | null {
  if (value === '' || (value === 'tt' && size <= 19)) return null;
  const x = value.charCodeAt(0) - 97;
  const y = value.charCodeAt(1) - 97;
  if (value.length !== 2 || x < 0 || y < 0 || x >= size || y >= size) throw new Error(`Bad SGF point ${value}`);
  return y * size + x;
}

function points(size: number, values: string[]): number[] {
  return values.flatMap((v) => {
    const [a, b] = v.split(':');
    const from = point(size, a);
    if (from === null) return [];
    if (b === undefined) return [from];
    const to = point(size, b);
    if (to === null) return [from];
    const out: number[] = [];
    for (let y = Math.floor(from / size); y <= Math.floor(to / size); y++)
      for (let x = from % size; x <= to % size; x++) out.push(y * size + x);
    return out;
  });
}

function result(value: string | undefined): SgfGame['result'] {
  if (!value) return null;
  if (value === '0' || /^draw|^jigo/i.test(value)) return { winner: null, margin: 0 };
  const m = /^([BW])\+(.*)$/i.exec(value.trim());
  if (!m) return null;
  const margin = Number(m[2]);
  return { winner: m[1].toUpperCase() === 'B' ? 'black' : 'white', margin: m[2] !== '' && Number.isFinite(margin) ? margin : null };
}

export function parseSgf(text: string): SgfGame {
  const nodes = mainLine(text);
  const root = nodes[0] ?? new Map();
  const size = Number((root.get('SZ')?.[0] ?? '19').split(':')[0]);
  const komi = Number(root.get('KM')?.[0] ?? 0) || 0;
  const setupOf = (node: Node): SgfSetup | null =>
    node.has('AB') || node.has('AW') || node.has('AE')
      ? { black: points(size, node.get('AB') ?? []), white: points(size, node.get('AW') ?? []), empty: points(size, node.get('AE') ?? []) }
      : null;
  const setup = setupOf(root) ?? { black: [], white: [], empty: [] };
  const moves: SgfMove[] = [];
  // Setup in a later node waits for the next move; several such nodes merge.
  let pending: SgfSetup | null = null;
  for (const node of nodes.slice(1)) {
    const more = setupOf(node);
    if (more)
      pending = pending
        ? { black: [...pending.black, ...more.black], white: [...pending.white, ...more.white], empty: [...pending.empty, ...more.empty] }
        : more;
    for (const [ident, color] of [
      ['B', 'black'],
      ['W', 'white'],
    ] as const) {
      const value = node.get(ident)?.[0];
      if (value === undefined) continue;
      moves.push({ color, point: point(size, value), ...(pending ? { setup: pending } : {}) });
      pending = null;
    }
  }
  return { size, komi, result: result(root.get('RE')?.[0]), setup, moves };
}

/**
 * Plays a record through the rules, throwing at the first move they reject. Play ends at two passes in
 * a row, and that position is returned: records go on to show the cleanup afterwards, and their result
 * is the score where play ended. The moves after it are still played out, on a copy, so none goes unchecked.
 */
export function replaySgf(game: SgfGame): GameState {
  const place = (state: GameState, setup: SgfSetup): GameState => {
    const board: Stone[] = state.board.slice();
    for (const p of setup.empty) board[p] = EMPTY;
    for (const p of setup.black) board[p] = BLACK;
    for (const p of setup.white) board[p] = WHITE;
    return { ...state, board, seen: new Set([...state.seen, situationKey(board, state.toPlay)]) };
  };
  const start = newGame(game.size);
  let state: GameState = place({ ...start, komi: game.komi, seen: new Set() }, game.setup);
  let ended: GameState | null = null;
  game.moves.forEach((m, i) => {
    if (state.phase === 'scoring') {
      ended ??= state;
      state = resumePlay(state);
    }
    if (m.setup) state = place(state, m.setup);
    // Handicap games give White the first move, and edited records may have a colour move twice.
    state = { ...state, toPlay: m.color };
    if (m.point === null) {
      state = pass(state);
      return;
    }
    const r = play(state, m.point);
    if (!r.ok) throw new Error(`move ${i + 1} (${m.color === 'black' ? 'B' : 'W'} ${pointName(game.size, m.point)}): ${r.reason}`);
    state = r.state;
  });
  return ended ?? state;
}
