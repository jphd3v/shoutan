import { pointFromName } from '../rules';
import { restoreGame, savedGame, savedMeta } from '../saved';
import { Action, guessDeadNow, reduce, Session, Settings, startSession } from '../session';

const HOTSEAT: Settings = { size: 9, opponent: 'human', humanColor: 'black', handicap: 0 };
const p = (name: string) => pointFromName(9, name);
/** The guess two passes start finishes before the next action, as it does in the app between taps. */
const settled = (s: Session) => (s.guessing ? reduce(s, { type: 'deadGuessed', ...guessDeadNow(s.game) }) : s);
const run = (s: Session, ...actions: Action[]) => actions.reduce((x, a) => settled(reduce(x, a)), s);
const tap = (name: string): Action => ({ type: 'tap', point: p(name) });
const aiPlays = (name: string): Action => ({ type: 'ai', decision: { kind: 'play', point: p(name), winRate: 0.5 } });
/** Saves and restores through JSON, the way the phone stores it. */
const roundTrip = (s: Session) => restoreGame(JSON.parse(JSON.stringify(savedGame(s))));

describe('saved games', () => {
  it('a game with no moves or a finished game is not saved', () => {
    expect(savedGame(startSession())).toBeNull();
    expect(savedGame(run(startSession(HOTSEAT), tap('E5'), { type: 'resign' }))).toBeNull();
  });

  it('restores the position, captures, turn and undo of a two-player game', () => {
    const s = run(startSession(HOTSEAT), tap('E5'), tap('D5'), tap('A1'), tap('F5'), tap('A2'), tap('E4'), tap('A3'), tap('E6'));
    const back = roundTrip(s)!;
    expect(back.settings).toEqual(s.settings);
    expect(back.game.board).toEqual(s.game.board);
    expect(back.game.captures).toEqual(s.game.captures);
    expect(back.game.toPlay).toBe(s.game.toPlay);
    expect(back.history).toHaveLength(s.history.length);
    expect(reduce(back, { type: 'undo' }).game.board).toEqual(reduce(s, { type: 'undo' }).game.board);
  });

  it('restores a game against the bot, including a handicap game the bot opened', () => {
    const vsBot: Settings = { ...HOTSEAT, opponent: 'ai', handicap: 2, size: 9 };
    const s = run(startSession(vsBot), aiPlays('E5'), tap('C7'), aiPlays('D4'));
    const back = roundTrip(s)!;
    expect(back.game.board).toEqual(s.game.board);
    expect(back.game.toPlay).toBe('black');
    expect(back.game.handicap).toBe(2);
  });

  it('keeps the bot’s level, and a game saved before there were levels is against level 1', () => {
    const hard = run(startSession({ ...HOTSEAT, opponent: 'ai', bot: 5 }), tap('E5'));
    expect(roundTrip(hard)!.settings.bot).toBe(5);
    const old = run(startSession({ ...HOTSEAT, opponent: 'ai' }), tap('E5'));
    expect(roundTrip(old)!.settings.bot).toBeUndefined();
    expect(restoreGame({ ...savedGame(hard)!, settings: { ...hard.settings, bot: 8 } })).toBeNull();
    expect(restoreGame({ ...savedGame(hard)!, settings: { ...hard.settings, bot: 'unknown-bot' } })).toBeNull();
  });

  it('keeps which network the bot plays, and refuses one it doesn’t know', () => {
    const s = run(startSession({ ...HOTSEAT, opponent: 'ai', bot: 5, botNet: 'human' }), tap('E5'));
    expect(restoreGame(savedGame(s))!.settings.botNet).toBe('human');
    expect(restoreGame({ ...savedGame(s)!, settings: { ...s.settings, botNet: 'gnugo' } })).toBeNull();
  });

  it('restores a one-stone game, Black having played first', () => {
    const s = run(startSession({ ...HOTSEAT, handicap: 1 }), tap('E5'), tap('C3'));
    const back = roundTrip(s)!;
    expect(back.game.board).toEqual(s.game.board);
    expect(back.game.komi).toBe(0.5);
  });

  it('restores a game reviewing dead stones with the players’ marks, and a pass before it', () => {
    const marked = run(startSession(HOTSEAT), tap('E5'), tap('A1'), { type: 'pass' }, { type: 'pass' });
    const changed = reduce(marked, tap('A1'));
    const back = roundTrip(changed)!;
    expect(back.game.phase).toBe('scoring');
    expect([...back.game.dead].sort()).toEqual([...changed.game.dead].sort());

    const passed = run(startSession(HOTSEAT), tap('E5'), { type: 'pass' });
    expect(roundTrip(passed)!.game.consecutivePasses).toBe(1);
  });

  it('keeps the stones marked unsure', () => {
    const review = run(startSession(HOTSEAT), tap('E5'), tap('A1'), { type: 'pass' }, { type: 'pass' });
    expect(review.game.unsure?.size).toBeGreaterThan(0);
    const back = roundTrip(review)!;
    expect([...back.game.unsure!].sort()).toEqual([...review.game.unsure!].sort());
    expect(back.guessing).toBeFalsy();
  });

  it('a review saved before its guess was done guesses after the restart', () => {
    const guessing = reduce(run(startSession(HOTSEAT), tap('E5'), { type: 'pass' }), { type: 'pass' });
    const back = roundTrip(guessing)!;
    expect(back.game.phase).toBe('scoring');
    expect(back.guessing).toBe(true);
  });

  it('restores play that resumed after a review', () => {
    const s = run(startSession(HOTSEAT), tap('E5'), { type: 'pass' }, { type: 'pass' }, { type: 'resume' }, tap('C3'));
    const back = roundTrip(s)!;
    expect(back.game.phase).toBe('playing');
    expect(back.game.board).toEqual(s.game.board);
    // Resumed with no move since: still playing after the restart, and undo returns to the review.
    const justResumed = run(startSession(HOTSEAT), tap('E5'), { type: 'pass' }, { type: 'pass' }, { type: 'resume' });
    const restored = roundTrip(justResumed)!;
    expect(restored.game.phase).toBe('playing');
    expect(restored.game.consecutivePasses).toBe(0);
    expect(restored.history).toHaveLength(justResumed.history.length);
  });

  it('keeps the game’s id and start time; a game saved without them has none', () => {
    const s = run(startSession(HOTSEAT), tap('E5'));
    const stored = JSON.parse(JSON.stringify(savedGame(s, { id: 'abc', startedAt: '2026-10-18T10:00:00.000Z' })));
    expect(savedMeta(stored)).toEqual({ id: 'abc', startedAt: '2026-10-18T10:00:00.000Z' });
    expect(restoreGame(stored)!.game.board).toEqual(s.game.board);
    expect(savedMeta(JSON.parse(JSON.stringify(savedGame(s))))).toBeNull();
    expect(savedMeta({ ...stored, startedAt: 'soon' })).toEqual({ id: 'abc', startedAt: null });
  });

  it('keeps that the Coach was on, so a game picked up again after a restart still moves no rating', () => {
    const s = run(startSession(HOTSEAT), tap('E5'));
    const stored = JSON.parse(JSON.stringify(savedGame(s, { id: 'abc', startedAt: null, coached: true })));
    expect(savedMeta(stored)).toEqual({ id: 'abc', startedAt: null, coached: true });
    expect(savedMeta({ ...stored, coached: 'yes' })).toEqual({ id: 'abc', startedAt: null });
  });

  it('rejects anything that does not replay', () => {
    const good = JSON.parse(JSON.stringify(savedGame(run(startSession(HOTSEAT), tap('E5')))));
    expect(restoreGame(null)).toBeNull();
    expect(restoreGame('nonsense')).toBeNull();
    expect(restoreGame({ ...good, v: 99 })).toBeNull();
    expect(restoreGame({ ...good, settings: { ...good.settings, size: 7 } })).toBeNull();
    expect(restoreGame({ ...good, settings: { ...good.settings, handicap: 6 } })).toBeNull();
    // The same point twice is an illegal move.
    expect(restoreGame({ ...good, moves: [p('E5'), p('E5')] })).toBeNull();
    expect(restoreGame({ ...good, moves: ['E5'] })).toBeNull();
  });
});
