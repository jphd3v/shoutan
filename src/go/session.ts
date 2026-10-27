import { guessDead } from './ai';
import type { AiDecision } from './katago';
import { botRating, BotNet, handicapFor, rated, Rating } from './rating';
import {
  acceptScore,
  Color,
  EMPTY,
  GameState,
  IllegalReason,
  maxHandicap,
  newGame,
  other,
  pass,
  play,
  resign,
  resumePlay,
  setDead,
  toggleDead,
} from './rules';

export type Opponent = 'human' | 'ai';
/**
 * How well the bot plays, weakest first: every level plays the network of `katago.ts`, following it more
 * closely at each level until 7 plays its favourite every time.
 */
export const BOT_LEVELS = [1, 2, 3, 4, 5, 6, 7] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const BOARD_SIZES = [9, 13, 19] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];

export interface Settings {
  size: BoardSize;
  opponent: Opponent;
  /** The human's colour when playing the AI. */
  humanColor: Color;
  /** Black's handicap stones: 0 for an even game, 1 to `maxHandicap(size)` otherwise. */
  handicap: number;
  /** The bot's level when playing the AI; absent is level 1, as in games saved before there were levels. */
  bot?: BotLevel;
  /** The network the bot plays; absent is `kata`, as in games saved before there was a choice. */
  botNet?: BotNet;
}

export const botLevel = (s: Settings): BotLevel => s.bot ?? 1;
export const botNetOf = (s: Settings): BotNet => s.botNet ?? 'kata';

/**
 * The level nearest the player's strength on this board. Ties go to the weaker level, so a close game
 * is never a surprise thrashing.
 */
export function levelFor(rating: number, size: number, net: BotNet = 'kata'): BotLevel {
  let best: BotLevel = 1;
  for (const level of BOT_LEVELS) {
    if (Math.abs(botRating(level, size, net) - rating) < Math.abs(botRating(best, size, net) - rating)) best = level;
  }
  return best;
}

export const DEFAULT_SETTINGS: Settings = { size: 9, opponent: 'ai', humanColor: 'black', handicap: 0 };

export interface Session {
  settings: Settings;
  game: GameState;
  /** Earlier states, most recent last, for undo. */
  history: readonly GameState[];
  /** Undone positions with the history that led to them, the next one last, for redo. */
  future?: readonly { game: GameState; history: readonly GameState[]; guessing?: boolean }[];
  /** Why the most recent human action was rejected; cleared by the next accepted one. */
  lastIllegal?: IllegalReason;
  /**
   * Play has just ended and the likely dead stones are still being worked out: marking and Count wait
   * for `deadGuessed`. The guess takes seconds on a phone, so the app runs it in slices (`guessDeadNow`
   * gives the same answer at once).
   */
  guessing?: boolean;
}

export type Action =
  | { type: 'tap'; point: number }
  | { type: 'pass' }
  | { type: 'resign' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'accept' }
  /** From a counted game back to marking dead stones, when the automatic guess was wrong. */
  | { type: 'fixDead' }
  | { type: 'resume' }
  /** The likely dead stones, once the guess that two passes started is done. */
  | { type: 'deadGuessed'; dead: number[]; unsure: number[] }
  | { type: 'ai'; decision: AiDecision }
  | { type: 'newGame'; settings: Settings }
  /** Starts a new game with some settings changed and the rest kept. */
  | { type: 'configure'; changes: Partial<Settings> };

/** Enough playouts to guess every real game in the test corpus right, few enough to answer within seconds on a phone. */
export const deadEstimatePlayouts = (size: number) => (size <= 9 ? 300 : size <= 13 ? 150 : 200);

/** The guess two passes wait for, worked out at once; the app runs the same playouts in slices. */
export const guessDeadNow = (game: GameState) => guessDead(game, { playouts: deadEstimatePlayouts(game.size) });

export function startSession(settings: Settings = DEFAULT_SETTINGS): Session {
  return { settings, game: newGame(settings.size, undefined, settings.handicap), history: [] };
}

export const aiColor = (s: Session): Color | null => (s.settings.opponent === 'ai' ? other(s.settings.humanColor) : null);

export const isAiTurn = (s: Session) => s.game.phase === 'playing' && aiColor(s) === s.game.toPlay;

/** The colour whose buttons are active: the player to move, or the human against the AI. */
export const actingColor = (s: Session): Color => (s.settings.opponent === 'ai' ? s.settings.humanColor : s.game.toPlay);

export function canUndo(s: Session): boolean {
  if (s.game.phase === 'over' || isAiTurn(s)) return false;
  if (s.settings.opponent === 'human') return s.history.some((g) => g.phase === 'playing');
  return s.history.some((g) => g.toPlay === s.settings.humanColor && g.phase === 'playing');
}

export const canRedo = (s: Session) => !!s.future?.length && s.game.phase !== 'over' && !isAiTurn(s);

/** A game that ended by score whose dead stones can still be changed; with no stones on the board there are none. */
export const canFixDead = (s: Session) =>
  s.game.phase === 'over' &&
  s.game.result?.reason === 'score' &&
  s.history[s.history.length - 1]?.phase === 'scoring' &&
  s.game.board.some((v) => v !== EMPTY);

/**
 * Stones the human takes against the bot on this board: their rank difference, none if the human is
 * stronger. At the level that suits them the level does the handicap's work, so none there either,
 * unless they are weaker than the weakest level.
 */
export function botHandicap(rating: number, size: number, level: BotLevel = 1, net: BotNet = 'kata'): number {
  if (level === levelFor(rating, size, net) && rating >= botRating(1, size, net)) return 0;
  const h = handicapFor(rating, botRating(level, size, net), size);
  return h.black === 'a' ? h.handicap : 0;
}

/** The player's rating after a finished game against the bot, or null for any other session. */
export function ratedAfter(s: Session, me: Rating): Rating | null {
  const winner = s.game.result?.winner;
  if (s.settings.opponent !== 'ai' || s.game.phase !== 'over' || !winner) return null;
  const { humanColor, handicap } = s.settings;
  return rated(
    me,
    botRating(botLevel(s.settings), s.game.size, botNetOf(s.settings)),
    winner === humanColor ? 'win' : 'loss',
    handicap,
    humanColor,
  );
}

/**
 * The next game between the same two people: the player who lost gets one more handicap stone,
 * or Black, having won, gets one fewer. After an even game the loser simply takes Black.
 */
export function rematchSetup(handicap: number, winner: Color, size: number): { handicap: number; black: 'winner' | 'loser' } {
  if (winner === 'white') return { handicap: Math.min(maxHandicap(size), handicap + 1), black: 'loser' };
  if (handicap === 0) return { handicap: 0, black: 'loser' };
  return { handicap: handicap - 1, black: 'winner' };
}

/**
 * Moves into a new state. Two passes end play and start guessing the likely dead stones, which the
 * players then check before Count; the marking stays in the history so `fixDead` can return to it.
 */
function advance(s: Session, game: GameState): Session {
  const next: Session = { settings: s.settings, game, history: [...s.history, s.game] };
  return game.phase === 'scoring' && s.game.phase === 'playing' ? { ...next, guessing: true } : next;
}

export function reduce(s: Session, action: Action): Session {
  const { game } = s;
  switch (action.type) {
    case 'tap': {
      if (game.phase === 'scoring') return s.guessing ? s : { ...s, game: toggleDead(game, action.point), lastIllegal: undefined };
      if (game.phase !== 'playing' || isAiTurn(s)) return s;
      const r = play(game, action.point);
      if (!r.ok) return { ...s, lastIllegal: r.reason };
      return advance(s, r.state);
    }
    case 'pass':
      if (game.phase !== 'playing' || isAiTurn(s)) return s;
      return advance(s, pass(game));
    case 'resign':
      if (game.phase === 'over') return s;
      return advance(s, resign(game, actingColor(s)));
    case 'ai': {
      if (!isAiTurn(s)) return s;
      const d = action.decision;
      if (d.kind === 'pass') return advance(s, pass(game));
      if (d.kind === 'resign') return advance(s, resign(game, game.toPlay));
      const r = play(game, d.point);
      // The search only proposes legal points; anything else is a bug worth surfacing.
      if (!r.ok) throw new Error(`AI proposed illegal move ${d.point}: ${r.reason}`);
      return advance(s, r.state);
    }
    case 'undo': {
      if (!canUndo(s)) return s;
      const history = s.history.slice();
      let prev = history.pop()!;
      // Reviewing dead stones isn't a move: undo passes over it, also after Keep playing.
      while (prev.phase !== 'playing' || (s.settings.opponent === 'ai' && prev.toPlay !== s.settings.humanColor)) prev = history.pop()!;
      const undone = { game, history: s.history, ...(s.guessing ? { guessing: true } : {}) };
      return { settings: s.settings, game: prev, history, future: [...(s.future ?? []), undone] };
    }
    case 'redo': {
      if (!canRedo(s)) return s;
      const future = s.future!.slice();
      const next = future.pop()!;
      // A review undone before its guess was done guesses again.
      return { settings: s.settings, game: next.game, history: next.history, future, ...(next.guessing ? { guessing: true } : {}) };
    }
    case 'deadGuessed':
      if (!s.guessing || game.phase !== 'scoring') return s;
      return { settings: s.settings, game: setDead(game, action.dead, action.unsure), history: s.history, future: s.future };
    case 'accept':
      if (game.phase !== 'scoring' || s.guessing) return s;
      return advance(s, acceptScore(game));
    case 'fixDead': {
      if (!canFixDead(s)) return s;
      const history = s.history.slice();
      return { settings: s.settings, game: history.pop()!, history };
    }
    case 'resume':
      if (game.phase !== 'scoring') return s;
      return advance(s, resumePlay(game));
    case 'newGame':
      return startSession(action.settings);
    case 'configure':
      return startSession({ ...s.settings, ...action.changes });
  }
}
