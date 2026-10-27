import { pointFromName } from '../rules';
import {
  Action,
  canFixDead,
  canRedo,
  canUndo,
  guessDeadNow,
  isAiTurn,
  reduce,
  rematchSetup,
  Session,
  Settings,
  startSession,
  botHandicap,
  BOT_LEVELS,
  BotLevel,
  levelFor,
  ratedAfter,
} from '../session';
import { botRating } from '../rating';

const HOTSEAT: Settings = { size: 9, opponent: 'human', humanColor: 'black', handicap: 0 };
const VS_AI: Settings = { size: 9, opponent: 'ai', humanColor: 'black', handicap: 0 };
const p = (name: string) => pointFromName(9, name);
/** The guess two passes start finishes before the next action, as it does in the app between taps. */
const settled = (s: Session) => (s.guessing ? reduce(s, { type: 'deadGuessed', ...guessDeadNow(s.game) }) : s);
const run = (s: Session, ...actions: Action[]) => actions.reduce((x, a) => settled(reduce(x, a)), s);
const tap = (name: string): Action => ({ type: 'tap', point: p(name) });
const aiPlays = (name: string): Action => ({ type: 'ai', decision: { kind: 'play', point: p(name), winRate: 0.5 } });

describe('session', () => {
  it('defaults to 9x9 against the AI with the human as Black', () => {
    const s = startSession();
    expect(s.settings).toEqual(VS_AI);
    expect(s.game.size).toBe(9);
    expect(isAiTurn(s)).toBe(false);
    expect(canUndo(s)).toBe(false);
  });

  it('records an illegal tap without changing the game, and clears it on the next move', () => {
    const s = run(startSession(HOTSEAT), tap('E5'));
    const bad = reduce(s, tap('E5'));
    expect(bad.game).toBe(s.game);
    expect(bad.lastIllegal).toBe('occupied');
    expect(reduce(bad, tap('D4')).lastIllegal).toBeUndefined();
  });

  it('two humans alternate, and undo takes back one move', () => {
    const s = run(startSession(HOTSEAT), tap('E5'), tap('D4'));
    expect(s.game.toPlay).toBe('black');
    const u = reduce(s, { type: 'undo' });
    expect(u.game.toPlay).toBe('white');
    expect(u.game.moves).toHaveLength(1);
  });

  it('ignores human input on the AI turn and AI input on the human turn', () => {
    const s = run(startSession(), tap('E5'));
    expect(isAiTurn(s)).toBe(true);
    expect(reduce(s, tap('D4'))).toBe(s);
    expect(reduce(s, { type: 'pass' })).toBe(s);
    expect(canUndo(s)).toBe(false);
    const after = reduce(s, aiPlays('D4'));
    expect(after.game.moves).toHaveLength(2);
    expect(reduce(after, aiPlays('C3'))).toBe(after);
  });

  it('undo against the AI takes back the AI reply and the human move', () => {
    const s = run(startSession(), tap('E5'), aiPlays('D4'), tap('C3'), aiPlays('F6'));
    const u = reduce(s, { type: 'undo' });
    expect(u.game.moves).toHaveLength(2);
    expect(u.game.toPlay).toBe('black');
    const u2 = reduce(u, { type: 'undo' });
    expect(u2.game.moves).toHaveLength(0);
    expect(canUndo(u2)).toBe(false);
  });

  it('redo steps forward again through undone moves, one at a time', () => {
    const s = run(startSession(HOTSEAT), tap('E5'), tap('D4'), tap('C3'));
    expect(canRedo(s)).toBe(false);
    const back2 = run(s, { type: 'undo' }, { type: 'undo' });
    expect(back2.game.moves).toHaveLength(1);
    expect(canRedo(back2)).toBe(true);
    const fwd1 = reduce(back2, { type: 'redo' });
    expect(fwd1.game.moves).toHaveLength(2);
    const fwd2 = reduce(fwd1, { type: 'redo' });
    expect(fwd2.game).toBe(s.game);
    expect(canRedo(fwd2)).toBe(false);
    expect(reduce(fwd2, { type: 'redo' })).toBe(fwd2);
    // Undo still works after redoing: the history came back too.
    expect(reduce(fwd2, { type: 'undo' }).game).toBe(fwd1.game);
  });

  it('a new move from an earlier position drops the undone moves', () => {
    const back = run(startSession(HOTSEAT), tap('E5'), tap('D4'), { type: 'undo' });
    const branched = reduce(back, tap('F6'));
    expect(canRedo(branched)).toBe(false);
    expect(branched.game.moves).toHaveLength(2);
  });

  it('against the AI, redo restores your move and its reply together', () => {
    const s = run(startSession(), tap('E5'), aiPlays('D4'), tap('C3'), aiPlays('F6'));
    const back = run(s, { type: 'undo' }, { type: 'undo' });
    expect(back.game.moves).toHaveLength(0);
    const fwd = reduce(back, { type: 'redo' });
    expect(fwd.game.moves).toHaveLength(2);
    expect(isAiTurn(fwd)).toBe(false);
    expect(reduce(fwd, { type: 'redo' }).game).toBe(s.game);
  });

  it('when the human plays White, the AI moves first', () => {
    const s = startSession({ ...VS_AI, humanColor: 'white' });
    expect(isAiTurn(s)).toBe(true);
    const after = reduce(s, aiPlays('E5'));
    expect(isAiTurn(after)).toBe(false);
    // Undo cannot go back past the AI's opening move.
    expect(canUndo(after)).toBe(false);
  });

  it('two passes stop at a review of the likely dead stones; Count then counts the game', () => {
    const review = run(startSession(HOTSEAT), tap('E5'), tap('A1'), { type: 'pass' }, { type: 'pass' });
    expect(review.game.phase).toBe('scoring');
    expect(canFixDead(review)).toBe(false);
    const over = reduce(review, { type: 'accept' });
    expect(over.game.phase).toBe('over');
    expect(over.game.result?.reason).toBe('score');
    expect(canUndo(over)).toBe(false);
    expect(canFixDead(over)).toBe(true);
    // The marks are kept on the counted game, so the board can show what was taken off.
    expect(over.game.dead).toBe(review.game.dead);
  });

  it('two passes guess the dead stones; marking and Count wait for the guess', () => {
    const before = run(startSession(HOTSEAT), tap('E5'), tap('A1'), { type: 'pass' });
    const guessing = reduce(before, { type: 'pass' });
    expect(guessing.guessing).toBe(true);
    expect(guessing.game.dead.size).toBe(0);
    expect(reduce(guessing, tap('A1'))).toBe(guessing);
    expect(reduce(guessing, { type: 'accept' })).toBe(guessing);
    const guess = guessDeadNow(guessing.game);
    const review = reduce(guessing, { type: 'deadGuessed', ...guess });
    expect(review.guessing).toBeFalsy();
    expect([...review.game.dead].sort()).toEqual(guess.dead);
    expect(review.history).toBe(guessing.history);
    // A late guess changes nothing once play has resumed.
    const resumed = reduce(guessing, { type: 'resume' });
    expect(reduce(resumed, { type: 'deadGuessed', ...guess })).toBe(resumed);
  });

  it('a review undone before its guess was done guesses again on redo', () => {
    const guessing = reduce(run(startSession(HOTSEAT), tap('E5'), tap('A1'), { type: 'pass' }), { type: 'pass' });
    const back = reduce(reduce(guessing, { type: 'undo' }), { type: 'redo' });
    expect(back.game.phase).toBe('scoring');
    expect(back.guessing).toBe(true);
  });

  it('fixing dead stones goes back to marking them; taps toggle; accept counts again', () => {
    const over = run(startSession(HOTSEAT), tap('E5'), tap('A1'), { type: 'pass' }, { type: 'pass' }, { type: 'accept' });
    const fixing = reduce(over, { type: 'fixDead' });
    expect(fixing.game.phase).toBe('scoring');
    expect(canFixDead(fixing)).toBe(false);
    const marked = reduce(fixing, tap('A1'));
    expect(marked.game.dead.has(p('A1'))).toBe(!fixing.game.dead.has(p('A1')));
    const ended = reduce(marked, { type: 'accept' });
    expect(ended.game.phase).toBe('over');
    expect(ended.game.dead).toBe(marked.game.dead);
  });

  it('a game counted with no stones on the board has no dead stones to fix', () => {
    const over = run(startSession(HOTSEAT), { type: 'pass' }, { type: 'pass' }, { type: 'accept' });
    expect(over.game.phase).toBe('over');
    expect(canFixDead(over)).toBe(false);
    expect(reduce(over, { type: 'fixDead' })).toBe(over);
  });

  it('a resignation has no dead stones to fix', () => {
    const s = run(startSession(HOTSEAT), tap('E5'), { type: 'resign' });
    expect(canFixDead(s)).toBe(false);
    expect(reduce(s, { type: 'fixDead' })).toBe(s);
  });

  it('keep playing from reviewing dead stones goes back to the game', () => {
    const s = run(startSession(HOTSEAT), tap('E5'), { type: 'pass' }, { type: 'pass' }, { type: 'resume' });
    expect(s.game.phase).toBe('playing');
  });

  it('undo while reviewing dead stones returns to before the last pass', () => {
    const s = run(startSession(HOTSEAT), tap('E5'), { type: 'pass' }, { type: 'pass' }, { type: 'undo' });
    expect(s.game.phase).toBe('playing');
    expect(s.game.consecutivePasses).toBe(1);
  });

  it('undo after keep playing goes back a move, not to reviewing dead stones', () => {
    const resumed = run(startSession(HOTSEAT), tap('E5'), { type: 'pass' }, { type: 'pass' }, { type: 'resume' });
    const back = reduce(resumed, { type: 'undo' });
    expect(back.game.phase).toBe('playing');
    expect(back.game.consecutivePasses).toBe(1);
    expect(canRedo(back)).toBe(true);
    expect(reduce(back, { type: 'redo' }).game).toBe(resumed.game);
    const moved = run(resumed, tap('A1'));
    const undone = reduce(moved, { type: 'undo' });
    expect(undone.game).toBe(resumed.game);
    expect(reduce(undone, { type: 'undo' }).game.phase).toBe('playing');
  });

  it('undo after keep playing steps back through both passes, then runs out', () => {
    const resumed = run(startSession(HOTSEAT), { type: 'pass' }, { type: 'pass' }, { type: 'resume' });
    const once = reduce(resumed, { type: 'undo' });
    expect(once.game.consecutivePasses).toBe(1);
    const twice = reduce(once, { type: 'undo' });
    expect(twice.game.consecutivePasses).toBe(0);
    expect(canUndo(twice)).toBe(false);
  });

  it('against the bot, undo from reviewing dead stones skips the bot’s pass back to the human’s last turn', () => {
    const s = run(
      startSession(VS_AI),
      tap('E5'),
      aiPlays('A1'),
      { type: 'pass' },
      { type: 'ai', decision: { kind: 'pass', winRate: 0.5 } },
    );
    expect(s.game.phase).toBe('scoring');
    expect(canUndo(s)).toBe(true);
    const back = reduce(s, { type: 'undo' });
    expect(back.game.phase).toBe('playing');
    expect(back.game.toPlay).toBe('black');
    expect(back.game.moves).toHaveLength(2);
    expect(isAiTurn(back)).toBe(false);
    // Redo returns to the review as it was.
    expect(reduce(back, { type: 'redo' }).game).toBe(s.game);
  });

  it('marks changed while reviewing come back after undo and redo', () => {
    const review = run(startSession(HOTSEAT), tap('E5'), tap('A1'), { type: 'pass' }, { type: 'pass' });
    const changed = reduce(review, tap('E5'));
    expect(changed.game.dead.has(p('E5'))).toBe(!review.game.dead.has(p('E5')));
    expect(canRedo(changed)).toBe(false);
    const again = run(changed, { type: 'undo' }, { type: 'redo' });
    expect(again.game.phase).toBe('scoring');
    expect([...again.game.dead].sort()).toEqual([...changed.game.dead].sort());
    // Even with every mark cleared: the players' choice is not guessed over.
    const none = { ...review, game: { ...review.game, dead: new Set<number>(), unsure: undefined } };
    const redone = reduce(reduce(none, { type: 'undo' }), { type: 'redo' });
    expect(redone.guessing).toBeFalsy();
    expect(redone.game.dead.size).toBe(0);
  });

  it('in a two-player game the player to move resigns', () => {
    const s = run(startSession(HOTSEAT), tap('E5'), { type: 'resign' });
    expect(s.game.result).toEqual({ winner: 'black', reason: 'resignation' });
  });

  it('against the AI the human resigns, and the AI can resign too', () => {
    const human = run(startSession(), { type: 'resign' });
    expect(human.game.result).toEqual({ winner: 'white', reason: 'resignation' });
    const ai = run(startSession(), tap('E5'), { type: 'ai', decision: { kind: 'resign', winRate: 0 } });
    expect(ai.game.result).toEqual({ winner: 'black', reason: 'resignation' });
  });

  it('AI pass after a human pass ends play and stops at the review', () => {
    const s = run(
      startSession(),
      tap('E5'),
      aiPlays('D4'),
      { type: 'pass' },
      {
        type: 'ai',
        decision: { kind: 'pass', winRate: 0.5 },
      },
    );
    expect(s.game.phase).toBe('scoring');
    expect(isAiTurn(s)).toBe(false);
    expect(reduce(s, { type: 'accept' }).game.result?.reason).toBe('score');
  });

  it('configure changes some settings, keeps the rest and starts afresh', () => {
    const s = run(
      startSession(),
      tap('E5'),
      { type: 'configure', changes: { opponent: 'human' } },
      { type: 'configure', changes: { size: 19 } },
    );
    expect(s.settings).toEqual({ size: 19, opponent: 'human', humanColor: 'black', handicap: 0 });
    expect(s.game.moves).toHaveLength(0);
  });

  it('a handicap game against the bot starts with Black’s stones and the bot to move as White', () => {
    const s = startSession({ ...VS_AI, handicap: 4 });
    expect(s.game.board.filter((x) => x !== 0)).toHaveLength(4);
    expect(isAiTurn(s)).toBe(true);
    expect(canUndo(s)).toBe(false);
    expect(run(s, aiPlays('E5'), tap('D5')).game.toPlay).toBe('white');
    const after = run(s, aiPlays('E5'), tap('D5'), aiPlays('F5'));
    expect(canUndo(after)).toBe(true);
    expect(reduce(after, { type: 'undo' }).game.moves).toHaveLength(1);
  });

  it('changing size keeps the handicap, and the handicap can be changed on its own', () => {
    const s = run(startSession({ ...HOTSEAT, handicap: 2 }), { type: 'configure', changes: { size: 13 } });
    expect(s.game.board.filter((x) => x !== 0)).toHaveLength(2);
    expect(run(s, { type: 'configure', changes: { handicap: 0 } }).game.toPlay).toBe('black');
  });

  it('after a game against the bot, rates the player, and their rank calls for the bot’s handicap', () => {
    const botResigns: Action = { type: 'ai', decision: { kind: 'resign', winRate: 0 } };
    const won = (handicap: number) => run(startSession({ ...VS_AI, handicap }), ...(handicap ? [] : [tap('E5')]), botResigns);
    const lost = (handicap: number) => run(startSession({ ...VS_AI, handicap }), { type: 'resign' });
    const me = { rating: botRating(1, 9) - 400, games: 0 };
    const afterWin = ratedAfter(won(4), me)!;
    const afterLoss = ratedAfter(lost(4), me)!;
    expect(afterWin.rating).toBeGreaterThan(me.rating);
    expect(afterLoss.rating).toBeLessThan(me.rating);
    expect(afterWin.games).toBe(1);
    expect(ratedAfter(startSession(VS_AI), me)).toBeNull();
    expect(ratedAfter(run(startSession(HOTSEAT), { type: 'resign' }), me)).toBeNull();
    // Four ranks below the bot: four stones.
    expect(botHandicap(me.rating, 9)).toBe(4);
    expect(botHandicap(botRating(1, 9) + 500, 9)).toBe(0);
  });

  it('rates a game against a stronger level against its own, higher rating', () => {
    const me = { rating: botRating(1, 9), games: 5 };
    const lost = (bot?: BotLevel) => run(startSession({ ...VS_AI, bot }), { type: 'resign' });
    // Losing to the stronger bot costs less.
    expect(ratedAfter(lost(7), me)!.rating).toBeGreaterThan(ratedAfter(lost(), me)!.rating);
    expect(ratedAfter(lost(1), me)).toEqual(ratedAfter(lost(), me));
    expect(botHandicap(me.rating, 9, 7)).toBeGreaterThan(botHandicap(me.rating, 9));
  });

  it('suits the bot to the player: the nearest level, and no stones at it', () => {
    for (const size of [9, 13, 19] as const) {
      for (const level of BOT_LEVELS) {
        expect(levelFor(botRating(level, size), size)).toBe(level);
        expect(botHandicap(botRating(level, size) + 30, size, level)).toBe(0);
      }
      // Far stronger than the strongest: still the strongest.
      expect(levelFor(2900, size)).toBe(7);
    }
    // A player growing stronger meets a stronger bot.
    expect(levelFor(1300, 19)).toBeGreaterThan(levelFor(600, 19));
    // Weaker than level 1: level 1, with stones.
    expect(levelFor(-500, 9)).toBe(1);
    expect(botHandicap(-500, 9, 1)).toBeGreaterThan(0);
    // Choosing a stronger level than suits suggests stones to take.
    expect(botHandicap(botRating(2, 19), 19, 6)).toBeGreaterThan(0);
  });

  it('rates and suits the bot by the network it plays', () => {
    const me = { rating: 1500, games: 5 };
    const lost = (botNet?: 'human' | 'kata') => run(startSession({ ...VS_AI, bot: 7, botNet }), { type: 'resign' });
    expect(ratedAfter(lost('human'), me)!.rating).toBeGreaterThan(ratedAfter(lost('kata'), me)!.rating);
    expect(ratedAfter(lost(), me)).toEqual(ratedAfter(lost('kata'), me));
    expect(levelFor(botRating(6, 19, 'human'), 19, 'human')).toBe(6);
    expect(botHandicap(botRating(4, 19, 'human'), 19, 7, 'human')).toBeGreaterThan(botHandicap(botRating(4, 19, 'human'), 19, 7));
  });

  it('a rematch between two people gives the player who lost one more stone, or one fewer to give', () => {
    expect(rematchSetup(0, 'white', 19)).toEqual({ handicap: 1, black: 'loser' });
    expect(rematchSetup(1, 'white', 19)).toEqual({ handicap: 2, black: 'loser' });
    expect(rematchSetup(3, 'white', 19)).toEqual({ handicap: 4, black: 'loser' });
    expect(rematchSetup(9, 'white', 19)).toEqual({ handicap: 9, black: 'loser' });
    expect(rematchSetup(5, 'white', 9)).toEqual({ handicap: 5, black: 'loser' });
    expect(rematchSetup(4, 'black', 19)).toEqual({ handicap: 3, black: 'winner' });
    expect(rematchSetup(2, 'black', 19)).toEqual({ handicap: 1, black: 'winner' });
    expect(rematchSetup(1, 'black', 19)).toEqual({ handicap: 0, black: 'winner' });
    // An even game Black won: the loser takes Black next time.
    expect(rematchSetup(0, 'black', 19)).toEqual({ handicap: 0, black: 'loser' });
  });

  it('new game applies the chosen settings', () => {
    const s = reduce(run(startSession(), tap('E5')), {
      type: 'newGame',
      settings: { size: 13, opponent: 'human', humanColor: 'black', handicap: 0 },
    });
    expect(s.game.size).toBe(13);
    expect(s.game.moves).toHaveLength(0);
    expect(s.settings.opponent).toBe('human');
  });
});
