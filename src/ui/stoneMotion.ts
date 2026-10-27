/**
 * How the stones move when the board changes. Going back (undo) is the exact reverse of going
 * forward (a move, redo): a stone is set down and its captures fly to the captor's card; undone,
 * the stone lifts off and the captures fly back from the card. Pure, so it is tested without a device.
 */
import { colorOf, EMPTY, GameState, Move, Stone } from '../go/rules';

/** An undone stone lifts off, or a redone one slides back in, in this long. */
export const SLIDE_MS = 300;
/** When one change spans several moves (undoing your move and the bot's), each starts this much after the last. */
export const MOVE_GAP_MS = 200;
/** Captured stones leave (or return) one after another, this far apart. */
export const STAGGER_MS = 45;
/** A bigger jump (a new game, an online game catching up) is not played move by move. */
const MAX_MOVES = 4;

export interface StoneMotion {
  /** New stones, set down. */
  placed: { p: number; delay: number }[];
  /** Undone stones that lift off. */
  lifted: { p: number; s: Stone; delay: number }[];
  /** Captured stones that fly to the card of the other colour. */
  captured: { p: number; s: Stone; delay: number }[];
  /** Captured stones an undo puts back, flying in from the card of the other colour. */
  returned: { p: number; s: Stone; delay: number }[];
  /** Stones that shrink away in place (a new game). Stones that appear without a move just show. */
  vanished: { p: number; s: Stone }[];
}

const sameMove = (a: Move, b: Move) =>
  a.kind === b.kind && a.color === b.color && (a.kind !== 'play' || (b.kind === 'play' && a.point === b.point));

/** Whether `long` continues the game `short` by a few moves (compared by value: online games are rebuilt from their log). */
const continues = (long: readonly Move[], short: readonly Move[]) =>
  long.length > short.length && long.length - short.length <= MAX_MOVES && short.every((m, i) => sameMove(m, long[i]));

export function stoneMotion(before: GameState, after: GameState): StoneMotion {
  const motion: StoneMotion = { placed: [], lifted: [], captured: [], returned: [], vanished: [] };
  if (before.board === after.board || before.size !== after.size) return motion;
  const removed: { p: number; s: Stone }[] = [];
  const added: number[] = [];
  before.board.forEach((s, p) => {
    if (s !== EMPTY && after.board[p] !== s) removed.push({ p, s });
    if (after.board[p] !== EMPTY && after.board[p] !== s) added.push(p);
  });

  if (continues(after.moves, before.moves)) {
    const fresh = after.moves.slice(before.moves.length);
    const gap = (i: number) => i * MOVE_GAP_MS;
    fresh.forEach((m, i) => {
      if (m.kind === 'play' && added.includes(m.point)) motion.placed.push({ p: m.point, delay: gap(i) });
    });
    // A stone is captured by the latest new move of the other colour that took stones.
    removed.forEach(({ p, s }, k) => {
      let by = fresh.length - 1;
      for (; by > 0; by--) {
        const m = fresh[by];
        if (m.kind === 'play' && m.captured > 0 && m.color !== colorOf(s)) break;
      }
      motion.captured.push({ p, s, delay: gap(by) + STAGGER_MS * k });
    });
  } else if (continues(before.moves, after.moves)) {
    // Newest move first, then the stones it had captured come back.
    const undone = before.moves.slice(after.moves.length).reverse();
    undone.forEach((m, i) => {
      const r = m.kind === 'play' ? removed.find((x) => x.p === m.point) : undefined;
      if (r) motion.lifted.push({ ...r, delay: i * MOVE_GAP_MS });
    });
    const back = (undone.length - 1) * MOVE_GAP_MS + SLIDE_MS / 2;
    added.forEach((p, k) => motion.returned.push({ p, s: after.board[p], delay: back + STAGGER_MS * k }));
    for (const r of removed) if (!motion.lifted.some((x) => x.p === r.p)) motion.vanished.push(r);
  } else if (!added.length && after.moves.length === before.moves.length && after.moves.every((m, i) => sameMove(m, before.moves[i]))) {
    // Dead stones taken off at the count, with no move made: they go to their captor's card as a capture would.
    removed.forEach((r, k) => motion.captured.push({ ...r, delay: STAGGER_MS * k }));
  } else {
    motion.vanished.push(...removed);
  }
  return motion;
}
