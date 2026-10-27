/**
 * What the player should hear, feel and see when the game changes: one decision for the
 * offline and the online board. Pure, so every case is tested without a device.
 */
import { Color, EMPTY, GameState } from '../go/rules';

export type SoundName = 'stone' | 'capture' | 'captureMany' | 'illegal' | 'pass' | 'turn' | 'tick' | 'win' | 'end' | 'undo';

export interface Cue {
  /** Sounds with their delay in milliseconds, in order. */
  sounds: { name: SoundName; delay: number }[];
  haptic: 'light' | 'medium' | 'warning' | 'success' | null;
  /** Shake the board: a refused move. */
  shake: boolean;
  /** Who just passed, for a short note on the board. */
  passed: Color | null;
  /** The pass ended play: both players have passed, and the stones are marked next. */
  ended: boolean;
  /** Points whose stones were just captured. */
  captured: number[];
}

export interface CueContext {
  /** This change is a refused move (every refusal counts, also the same one twice). */
  refused?: boolean;
  /** The colour this phone plays, or null when both players share it (the result always celebrates). */
  viewer: Color | null;
  /** Chime when the other player's move arrives (online). */
  chimeForOpponent?: boolean;
  /** The board counts a scored result step by step first; `resultCue` plays when the count ends. */
  deferResult?: boolean;
  /** This change takes a move back. */
  undone?: boolean;
}

/** From this many captured stones, the bigger rattle plays. */
const MANY = 4;

const none = (): Cue => ({ sounds: [], haptic: null, shake: false, passed: null, ended: false, captured: [] });

export function cueFor(before: GameState, after: GameState, ctx: CueContext): Cue | null {
  if (ctx.refused) {
    return { ...none(), sounds: [{ name: 'illegal', delay: 0 }], haptic: 'warning', shake: true };
  }
  if (before === after) return null;
  if (ctx.undone) return { ...none(), sounds: [{ name: 'undo', delay: 0 }] };

  const cue = none();
  const added = after.moves.length > before.moves.length ? after.moves[after.moves.length - 1] : null;
  if (added?.kind === 'play') {
    cue.captured = after.board.flatMap((s, p) => (s === EMPTY && before.board[p] !== EMPTY && p !== added.point ? [p] : []));
    cue.sounds.push({ name: 'stone', delay: 0 });
    if (cue.captured.length) cue.sounds.push({ name: cue.captured.length >= MANY ? 'captureMany' : 'capture', delay: 90 });
    cue.haptic = cue.captured.length ? 'medium' : 'light';
  } else if (added?.kind === 'pass') {
    cue.sounds.push({ name: 'pass', delay: 0 });
    cue.passed = added.color;
    cue.ended = before.phase === 'playing' && after.phase === 'scoring';
    cue.haptic = 'light';
  }
  if (added && added.kind !== 'resign' && ctx.chimeForOpponent && ctx.viewer && added.color !== ctx.viewer) {
    cue.sounds.push({ name: 'turn', delay: 250 });
  }

  if (before.phase === 'scoring' && after.phase === 'scoring' && before.dead !== after.dead) {
    cue.sounds.push({ name: 'tick', delay: 0 });
  }

  if (before.phase !== 'over' && after.phase === 'over' && after.result && !(ctx.deferResult && after.result.reason === 'score')) {
    const end = resultCue(after, ctx.viewer);
    cue.sounds.push({ ...end.sounds[0], delay: cue.sounds.length ? 300 : 0 });
    cue.haptic = end.haptic;
  }

  return cue.sounds.length || cue.haptic ? cue : null;
}

/** The tune for a finished game: a celebration for the winner (or when both players share the phone). */
export function resultCue(after: GameState, viewer: Color | null): Cue {
  const celebrate = viewer === null || after.result?.winner === viewer;
  return { ...none(), sounds: [{ name: celebrate ? 'win' : 'end', delay: 0 }], haptic: 'success' };
}
