import { renderHook } from '@testing-library/react-native';
import { pointFromName } from '../../go/rules';
import { Action, guessDeadNow, reduce, Session, startSession } from '../../go/session';
import type { LobbyState } from '../../net/lobby';
import { setLanguage } from '../../ui/i18n';
import type { Profile } from '../../ui/prefs';
import { FinishedGame, isNewer, readFinished } from '../../go/finished';
import { readable } from '../../go/__tests__/records';
import { useShownGame } from '../shownGame';

beforeEach(() => setLanguage('en'));

const profile: Profile = { name: 'John Doe', level: 'beginner', rating: 150, games: 0 };

/** The game on this phone, shown with no online game open; returns the shown game and the actions it sent. */
async function shownSession(session: Session) {
  const sent: Action[] = [];
  const { result } = await renderHook(() =>
    useShownGame({
      session,
      dispatch: (a) => sent.push(a),
      lastAction: null,
      online: null,
      lobby: null,
      lobbyState: null,
      profile,
      me: null,
      onNewGame: () => sent.push({ type: 'configure', changes: {} }),
      onOpened: () => {},
      onCancelled: () => {},
      review: null,
    }),
  );
  return { shown: result.current, sent };
}

const tap = (s: Session, name: string) => reduce(s, { type: 'tap', point: pointFromName(s.game.size, name) });

describe('the game on this phone, shown', () => {
  it('against the bot, the player at the phone is the viewer and the bot names itself', async () => {
    const { shown } = await shownSession(startSession({ size: 9, opponent: 'ai', humanColor: 'white', handicap: 0 }));
    expect(shown.viewer).toBe('white');
    expect(shown.bot).toBe('black');
    expect(shown.facing).toBe(false);
    expect([shown.nameOf('black'), shown.nameOf('white')]).toEqual(['Bot', 'John Doe']);
    expect(shown.who('black')).toBe('bot');
    expect(shown.thinking).toBe(true);
    expect(shown.canPlay).toBe(false);
  });

  it('face to face there is no viewer, players are their colours, and each control sends its action', async () => {
    const played = tap(startSession({ size: 9, opponent: 'human', humanColor: 'black', handicap: 0 }), 'E5');
    const { shown, sent } = await shownSession(played);
    expect(shown.viewer).toBeNull();
    expect(shown.facing).toBe(true);
    expect(shown.who('white')).toBe('white');
    expect(shown.avatarOf('black')).toBeNull();
    expect(shown.controls.stage).toBe('playing');
    expect(shown.controls.undo?.enabled).toBe(true);
    expect(shown.controls.redo?.enabled).toBe(false);
    expect(shown.resignWarning).toBe('Resign? White will lose this game.');
    shown.controls.pass.run();
    shown.controls.undo!.run();
    shown.resign();
    shown.tap(pointFromName(9, 'C3'));
    expect(sent.map((a) => a.type)).toEqual(['pass', 'undo', 'resign', 'tap']);
  });

  it('after two passes, Count waits for the dead-stone guess and is nudged once it is done', async () => {
    let s = startSession({ size: 9, opponent: 'human', humanColor: 'black', handicap: 0 });
    s = reduce(reduce(tap(tap(s, 'C3'), 'G7'), { type: 'pass' }), { type: 'pass' });
    const guessing = (await shownSession(s)).shown;
    expect(guessing.controls.stage).toBe('scoring');
    expect(guessing.controls.accept).toMatchObject({ label: 'Count', enabled: false, nudge: false });
    expect(guessing.status(null)).toBe('Looking for stones that can’t escape…');
    const guessed = (await shownSession(reduce(s, { type: 'deadGuessed', ...guessDeadNow(s.game) }))).shown;
    expect(guessed.controls.accept).toMatchObject({ enabled: true, nudge: !guessed.game.unsure?.size });
  });

  it('a finished game offers a new one and names the winner', async () => {
    const over = reduce(startSession({ size: 9, opponent: 'ai', humanColor: 'black', handicap: 0 }), { type: 'resign' });
    const { shown, sent } = await shownSession(over);
    expect(shown.controls.stage).toBe('over');
    expect(shown.result).toEqual({ title: 'Bot wins', subtitle: 'You resigned' });
    expect(shown.resignWarning).toBeNull();
    shown.controls.again!.run();
    expect(sent).toEqual([{ type: 'configure', changes: {} }]);
  });
});

describe('a kept game under review', () => {
  const record = (file: string): FinishedGame => {
    const found = readFinished(readable().find(([f]) => f.endsWith(file))![1]);
    if (!found || isNewer(found)) throw new Error(`${file} is not a readable record`);
    return found;
  };

  async function reviewed(r: FinishedGame, lobbyState: Pick<LobbyState, 'nameOf' | 'avatarOf'> | null = null) {
    let done = 0;
    const { result } = await renderHook(() =>
      useShownGame({
        session: startSession({ size: 9, opponent: 'ai', humanColor: 'black', handicap: 0 }),
        dispatch: () => {},
        lastAction: null,
        online: null,
        lobby: null,
        lobbyState: lobbyState && ({ ...lobbyState } as LobbyState),
        profile,
        me: null,
        onNewGame: () => {},
        onOpened: () => {},
        onCancelled: () => {},
        review: { record: r, onDone: () => done++ },
      }),
    );
    return { shown: result.current, done: () => done };
  }

  it('shows the finished game and its result, and nothing in it can be played', async () => {
    const r = record('bot-9-scored.json');
    const { shown, done } = await reviewed(r);
    expect(shown.game.phase).toBe('over');
    expect(shown.game.moves).toHaveLength(r.core.moves.length);
    expect(shown.result?.title).toMatch(/win/);
    expect(shown.tapMode).toBe('ignore');
    expect(shown.canPlay).toBe(false);
    expect(shown.controls.stage).toBe('over');
    expect(shown.newGame).toBeUndefined();
    expect(shown.resignWarning).toBeNull();
    shown.controls.again?.run();
    expect(done()).toBe(1);
  });

  it('names the sides as they were: you and the bot, the colours face to face', async () => {
    const bot = await reviewed(record('bot-9-scored.json'));
    expect(bot.shown.who(bot.shown.viewer!)).toBe('you');
    expect(bot.shown.bot).not.toBeNull();
    expect(bot.shown.who(bot.shown.bot!)).toBe('bot');
    const facing = await reviewed(record('face-to-face-9-resumed.json'));
    expect(facing.shown.viewer).toBeNull();
    expect(facing.shown.facing).toBe(false);
    expect(facing.shown.who('white')).toBe('white');
  });

  it('shows an online game with the opponent by name', async () => {
    const r = record('online-19-scored.json');
    const lobbyState = { nameOf: (id: string) => (id === r.meta.opponent ? 'Jane Doe' : undefined), avatarOf: () => null };
    const { shown } = await reviewed(r, lobbyState);
    const other = shown.viewer === 'black' ? 'white' : 'black';
    expect(shown.who(other)).toEqual({ name: 'Jane Doe' });
    expect(shown.nameOf(other)).toBe('Jane Doe');
  });
});
