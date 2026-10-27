import { BOARD_SIZES, BOT_LEVELS, Action, isAiTurn, reduce, Session, Settings, startSession } from './session';
import { maxHandicap, Move, setDead } from './rules';
import { BOT_NETS } from './rating';

/** The current game as stored on the phone, so it survives Android stopping the app. */
export interface SavedGame {
  v: 1;
  settings: Settings;
  /** Every move in order: the point played, or `PASS`. */
  moves: number[];
  /**
   * The stones marked dead while the players review them after two passes, and those marked unsure.
   * A game whose moves end in two passes but that has neither these nor `guessing` was resumed.
   */
  dead?: number[];
  unsure?: number[];
  /** Two passes ended play and the dead-stone guess had not finished. */
  guessing?: true;
  /** Who the game is, so it keeps its id and start time when it comes back after a restart. */
  id?: string;
  startedAt?: string;
  /** The Coach was on during one of the player's turns. */
  coached?: true;
  /** The player took a move back from the bot. */
  tookBack?: true;
}

/** A game's id, when its first move was made, and whether the Coach was on or a move was taken back, either of which leaves it unrated. */
export interface GameMeta {
  id: string;
  startedAt: string | null;
  coached?: true;
  tookBack?: true;
}

export const PASS = -1;

/** The moves as stored: each point played, or `PASS`. A resignation is not a move here; the result records it. */
export const encodeMoves = (moves: readonly Move[]): number[] =>
  moves.filter((m) => m.kind !== 'resign').map((m) => (m.kind === 'play' ? m.point : PASS));

/** The game worth keeping: one with moves that has not finished. */
export function savedGame(s: Session, meta?: GameMeta): SavedGame | null {
  const { game } = s;
  if (game.phase === 'over' || game.moves.length === 0) return null;
  const moves = encodeMoves(game.moves);
  return {
    v: 1,
    settings: s.settings,
    moves,
    ...(game.phase !== 'scoring'
      ? {}
      : s.guessing
        ? { guessing: true as const }
        : { dead: [...game.dead], ...(game.unsure?.size ? { unsure: [...game.unsure] } : {}) }),
    ...(meta
      ? {
          id: meta.id,
          ...(meta.startedAt ? { startedAt: meta.startedAt } : {}),
          ...(meta.coached ? { coached: true as const } : {}),
          ...(meta.tookBack ? { tookBack: true as const } : {}),
        }
      : {}),
  };
}

/** The id, start time, Coach and taken-back moves a saved game was kept with; null when it has none. */
export function savedMeta(x: unknown): GameMeta | null {
  const saved = x as Partial<SavedGame> | null;
  if (!saved || typeof saved.id !== 'string' || !saved.id) return null;
  return {
    id: saved.id,
    startedAt: typeof saved.startedAt === 'string' && !Number.isNaN(Date.parse(saved.startedAt)) ? saved.startedAt : null,
    ...(saved.coached === true ? { coached: true as const } : {}),
    ...(saved.tookBack === true ? { tookBack: true as const } : {}),
  };
}

function validSettings(x: unknown): x is Settings {
  const s = x as Partial<Settings> | null;
  return (
    !!s &&
    BOARD_SIZES.includes(s.size as never) &&
    (s.opponent === 'ai' || s.opponent === 'human') &&
    (s.humanColor === 'black' || s.humanColor === 'white') &&
    Number.isInteger(s.handicap) &&
    s.handicap! >= 0 &&
    s.handicap! <= maxHandicap(s.size!) &&
    (s.bot === undefined || BOT_LEVELS.includes(s.bot)) &&
    (s.botNet === undefined || BOT_NETS.includes(s.botNet))
  );
}

/**
 * Replays a saved game through the session, so undo works and the position is exactly the one
 * the rules produce. Anything that does not replay cleanly gives null, and a fresh game starts.
 */
export function restoreGame(x: unknown): Session | null {
  const saved = x as Partial<SavedGame> | null;
  if (!saved || saved.v !== 1 || !validSettings(saved.settings) || !Array.isArray(saved.moves)) return null;
  let s = startSession(saved.settings);
  for (const m of saved.moves) {
    if (!Number.isInteger(m)) return null;
    if (s.game.phase === 'scoring') s = reduce(s, { type: 'resume' });
    const ai = isAiTurn(s);
    const action: Action =
      m === PASS
        ? ai
          ? { type: 'ai', decision: { kind: 'pass', winRate: 0.5 } }
          : { type: 'pass' }
        : ai
          ? { type: 'ai', decision: { kind: 'play', point: m, winRate: 0.5 } }
          : { type: 'tap', point: m };
    let next: Session;
    try {
      next = reduce(s, action);
    } catch {
      return null;
    }
    if (next === s || next.lastIllegal || next.game.moves.length !== s.game.moves.length + 1) return null;
    s = next;
  }
  if (s.game.phase !== 'scoring' || saved.guessing) return s;
  if (!Array.isArray(saved.dead)) return reduce(s, { type: 'resume' });
  const points = (x: unknown) => (Array.isArray(x) ? x.filter((p) => Number.isInteger(p)) : []);
  return { settings: s.settings, game: setDead(s.game, points(saved.dead), points(saved.unsure)), history: s.history };
}
