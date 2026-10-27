import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { impactAsync } from 'expo-haptics';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';
import App from '../../App';
import { setVibrationOn } from '../ui/haptics';
import { language, phoneLanguage, setLanguage } from '../ui/i18n';
import { setSoundOn } from '../ui/sound';
import { evaluateNet } from '../../modules/go-net';
import { pointFromName } from '../go/rules';

// The bot's network: in tests, one that always favours C3, then D4.
let mockNetAvailable = true;
let mockHumanNet = false;
jest.mock('../../modules/go-net', () => ({
  BOT_NET: 'test-net',
  HUMAN_NET: 'test-human-net',
  get netAvailable() {
    return mockNetAvailable;
  },
  get humanNetAvailable() {
    return mockHumanNet;
  },
  preloadNet: jest.fn(),
  evaluateNet: jest.fn(),
}));
function fakeNet(size: number) {
  const policy = new Array(size * size).fill(-20);
  policy[pointFromName(size, 'C3')] = 5;
  policy[pointFromName(size, 'D4')] = 4;
  return { policy, pass: [-20], value: [0, 0, -20], score: [0], ownership: new Array(size * size).fill(0) };
}

/** A network that favours `name` above all else, as `fakeNet` favours C3. */
function netFavouring(name: string) {
  return async (_name: string, size: number) => {
    const out = fakeNet(size);
    out.policy[pointFromName(size, name)] = 9;
    return out;
  };
}

/** The screens as a player uses them: menu, board, Options and the result, with the real game logic. */

// Each tap comes a moment after the last, as a player's would, so the app's guard against double
// taps right after a phase change never swallows one.
let clock = 0;
const realNow = Date.now.bind(Date);
jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clock);
/** Taps a button, waiting for it if a sheet is still opening. */
async function tap(id: string) {
  clock += 1000;
  await fireEvent.press(await screen.findByTestId(id));
}
/** Face to face has no Settings button: the top-right menu opens the settings. */
async function openFacingSettings() {
  await tap('options');
  await tap('options-settings');
  await screen.findByTestId('guide-sheet');
}
/** Closes settings opened from the top-right menu, back to the game. */
async function closeFacingSettings() {
  await tap('sheet-close');
}
/** From the open top-right menu to the main menu, which keeps the game under Continue. */
async function toMainMenu() {
  await tap('options-hub');
}
/** Stepped back, the rest is hidden from screen readers too, so it is reached here as a stray finger would. */
async function pressHidden(id: string) {
  clock += 1000;
  await fireEvent.press(screen.getAllByTestId(id, { includeHiddenElements: true })[0]);
}
/** Passes, tapping again when the app asks because much of the board is still open; a second pass waits for the dead-stone guess. */
async function passAnyway(id: string) {
  await tap(id);
  if (screen.queryAllByText(/^There’s still open space to claim/).length) await tap(id);
  if (screen.queryAllByText(/^Looking for stones/).length) {
    expect(screen.getByTestId('accept').props.accessibilityState.disabled).toBe(true);
    await waitFor(() => expect(screen.queryAllByText(/^Looking for stones/)).toHaveLength(0), { timeout: 15000 });
  }
}
const point = (name: string) =>
  fireEvent(screen.getByTestId(`pt-${name}`), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
const label = (name: string) => screen.getByTestId(`pt-${name}`).props.accessibilityLabel as string;
const botLevelShown = () => screen.getByTestId('hub-bot').props.accessibilityValue.now as number;
const slideBot = (actionName: 'increment' | 'decrement') =>
  fireEvent(screen.getByTestId('hub-bot'), 'accessibilityAction', { nativeEvent: { actionName } });
const text = (id: string) => [screen.getByTestId(id).props.children].flat().join('');

/** Renders the app and lays out the board, which only draws once it knows its size. */
async function open() {
  const view = await render(<App />);
  await fireEvent(screen.getByTestId('board-area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 700 } } });
  return view;
}

async function start(mode: 'bot' | 'human', setup: (() => Promise<unknown>) | null = null) {
  await tap(`hub-play-${mode}`);
  if (setup) await setup();
  await tap('hub-start');
}
/** Starts a game in place of the unfinished one the main menu kept. */
async function startOver(mode: 'bot' | 'human', setup: (() => Promise<unknown>) | null = null) {
  await start(mode, setup);
  if (screen.queryByTestId('hub-replace-confirm')) await tap('hub-discard');
}

/** Waits for the bot's reply, which the app searches for in short slices. */
const botReplies = () =>
  waitFor(() => expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/, to play$/), { timeout: 15000 });

beforeEach(() => {
  localStorage.clear();
  mockNetAvailable = true;
  mockHumanNet = false;
  jest.mocked(evaluateNet).mockImplementation(async (_name, size) => fakeNet(size));
  // Most tests place stones with one tap; the default (tap twice) has its own test.
  localStorage.setItem('go.confirmMoves', 'off');
  // A player who has been welcomed; the first start has its own test.
  localStorage.setItem('go.profile', JSON.stringify({ name: 'Jane Doe', level: 'beginner', rating: 150, games: 0 }));
  setLanguage('en');
  setSoundOn(true);
  setVibrationOn(true);
});

describe('main menu', () => {
  it('starts a game against the bot, which replies; undo takes back both moves', async () => {
    await open();
    await start('bot');
    await point('E5');
    expect(label('E5')).toBe('E5, black stone');
    await botReplies();
    expect(screen.getAllByLabelText(/white stone/)).toHaveLength(1);
    // The first undo of a rated game says what it costs, and the second takes the moves back.
    await tap('undo');
    expect(text('status')).toBe('Taking a move back means this game won’t count for your rating. Tap Undo again to take it back.');
    expect(label('E5')).toBe('E5, black stone');
    await tap('undo');
    expect(label('E5')).toBe('E5, empty');
    await tap('redo');
    expect(label('E5')).toBe('E5, black stone');
  });

  it('the bot starts at the level that suits the player, and keeps how far they moved it', async () => {
    jest.mocked(evaluateNet).mockImplementation(async (_name, size) => fakeNet(size));
    // A 10 kyu: level 4 on 9×9, level 5 on 19×19.
    localStorage.setItem('go.profile', JSON.stringify({ name: 'Jane Doe', level: 'intermediate', rating: 1150, games: 3 }));
    localStorage.setItem('go.showRanks', 'on');
    await open();
    await tap('hub-play-bot');
    expect(botLevelShown()).toBe(4);
    expect(screen.getByText('Level 4 of 7 · about 10k · you 10k')).toBeTruthy();
    await tap('hub-size-19');
    expect(botLevelShown()).toBe(5);
    await tap('hub-size-9');
    // Moved to the strongest level, which always plays the network's favourite.
    for (let i = 0; i < 3; i++) await slideBot('increment');
    expect(botLevelShown()).toBe(7);
    expect(screen.getByText('Plays real Go, like a strong club player. A challenge.')).toBeTruthy();
    await tap('hub-start');
    await point('E5');
    await botReplies();
    expect(label('C3')).toBe('C3, white stone');
    expect(evaluateNet).toHaveBeenLastCalledWith('test-net', 9, expect.objectContaining({ planes: expect.any(Uint8Array) }));
    // Its favourite taken, it plays the next.
    await point('E4');
    await botReplies();
    expect(label('D4')).toBe('D4, white stone');
    await tap('options');
    await tap('new-game');
    await screen.findByTestId('hub-bot');
    expect(botLevelShown()).toBe(7);
    // Three levels above what suits on 9×9 is still the strongest on 19×19.
    await tap('hub-size-19');
    expect(botLevelShown()).toBe(7);
  });

  it('a new player meets level 1, with no ranks shown', async () => {
    await open();
    await tap('hub-play-bot');
    expect(botLevelShown()).toBe(1);
    expect(screen.getByText('Plays loosely. A gentle opponent to learn the moves with.')).toBeTruthy();
    expect(screen.queryByText(/^Level 1 of 7/)).toBeNull();
    // A phone that can't run the human-like network offers no choice of network.
    expect(screen.queryByTestId('hub-net-kata')).toBeNull();
    expect(screen.getByTestId('hub-net-note')).toHaveTextContent(/Plays with KataGo/);
  });

  it('the bot’s picture opens what it is like, then how it plays', async () => {
    await open();
    await start('bot');
    await tap('profile-white');
    const sheet = within(screen.getByTestId('bot-sheet'));
    expect(sheet.getByText('Bot')).toBeTruthy();
    expect(sheet.getByText('Level 1 of 7 · KataGo')).toBeTruthy();
    expect(sheet.getByText('1/7')).toBeTruthy();
    expect(sheet.getByText('Plays loosely. A gentle opponent to learn the moves with.')).toBeTruthy();
    expect(sheet.getByText(/^Plays at about \d+k on this board\.$/)).toBeTruthy();
    // The technical details are folded away until asked for.
    expect(sheet.queryByText(/^test-net: a small KataGo network/)).toBeNull();
    await tap('bot-details');
    expect(sheet.getByText(/^test-net: a small KataGo network/)).toBeTruthy();
    expect(sheet.getByText(/^on 50% of moves, any of the 20 likeliest$/)).toBeTruthy();
    expect(screen.getByTestId('profile-black')).toBeTruthy();
  });

  it('a human-like bot says which human rank it imitates', async () => {
    mockHumanNet = true;
    await open();
    await start('bot');
    await tap('profile-white');
    const sheet = within(screen.getByTestId('bot-sheet'));
    expect(sheet.getByText('Level 1 of 7 · Human-like')).toBeTruthy();
    expect(sheet.getByText(/^Plays like a human of about 25k/)).toBeTruthy();
    await tap('bot-details');
    expect(sheet.getByText(/^test-human-net: KataGo’s human-style network/)).toBeTruthy();
    expect(sheet.getByText('judged by test-net')).toBeTruthy();
  });

  it('on a phone that can run it, the bot plays human-like by default, at every level', async () => {
    mockHumanNet = true;
    // The human network is sure of G7; the small one, which only judges, favours C3.
    jest.mocked(evaluateNet).mockImplementation(async (name, size) => {
      if (name !== 'test-human-net') return fakeNet(size);
      const policy = new Array(size * size).fill(-20);
      policy[pointFromName(size, 'G7')] = 5;
      return { ...fakeNet(size), policy };
    });
    await open();
    await tap('hub-play-bot');
    expect(botLevelShown()).toBe(1);
    expect(screen.getByText('Plays like a human beginner: natural moves, natural mistakes.')).toBeTruthy();
    for (let i = 0; i < 6; i++) await slideBot('increment');
    expect(screen.getByText('Plays like a strong human player. A challenge.')).toBeTruthy();
    await tap('hub-start');
    await point('E5');
    await botReplies();
    expect(label('G7')).toBe('G7, white stone');
    expect(evaluateNet).toHaveBeenCalledWith(
      'test-human-net',
      9,
      expect.objectContaining({ planes: expect.any(Uint8Array) }),
      expect.any(Float32Array),
    );
  });

  it('the player can switch the bot to KataGo, every level then from the small network, and setup remembers it', async () => {
    mockHumanNet = true;
    jest.mocked(evaluateNet).mockClear();
    await open();
    await tap('hub-play-bot');
    expect(screen.queryByTestId('hub-net-note')).toBeNull();
    await tap('hub-net-kata');
    expect(screen.getByText('Plays loosely. A gentle opponent to learn the moves with.')).toBeTruthy();
    await tap('hub-start');
    await point('E5');
    await botReplies();
    expect(screen.queryAllByLabelText(/white stone/)).toHaveLength(1);
    expect(jest.mocked(evaluateNet).mock.calls.every(([name]) => name === 'test-net')).toBe(true);
    await tap('options');
    await tap('new-game');
    await screen.findByTestId('hub-bot');
    expect(screen.getByText('Plays loosely. A gentle opponent to learn the moves with.')).toBeTruthy();
  });

  it("if the network can't answer, the game says the bot can't run here instead of waiting", async () => {
    jest.mocked(evaluateNet).mockRejectedValue(new Error('no network'));
    await open();
    await start('bot');
    await point('E5');
    expect(await screen.findByText('The bot can’t run on this phone.')).toBeTruthy();
    expect(screen.queryAllByLabelText(/white stone/)).toHaveLength(0);
  });

  it('on a phone without the network the menu offers no bot, and says why', async () => {
    mockNetAvailable = false;
    await open();
    expect(screen.queryByTestId('hub-play-bot')).toBeNull();
    expect(screen.getByTestId('hub-no-bot')).toHaveTextContent('The bot can’t run on this phone.');
    expect(screen.getByTestId('hub-play-human')).toBeTruthy();
  });

  it('at a network level the bot passes back when it leads, and the network marks the dead stones', async () => {
    // The network sees the whole board as White's: from White's side while the bot thinks, from Black's after.
    jest.mocked(evaluateNet).mockImplementation(async (_name, size, inputs) => ({
      ...fakeNet(size),
      ownership: new Array(size * size).fill(inputs.globals[5] > 0 ? 5 : -5),
    }));
    await open();
    await start('bot', () => slideBot('increment'));
    await point('E5');
    await botReplies();
    await passAnyway('pass');
    // Playouts could only guess at a lone stone; the network is sure.
    await waitFor(() => expect(label('E5')).toBe('E5, black stone, marked dead'), { timeout: 15000 });
    expect(screen.getAllByLabelText(/white stone$/)).toHaveLength(1);
  });

  it('playing White, the bot opens as Black, and the ☰ menu’s New game keeps the player White', async () => {
    await open();
    await start('bot', () => tap('hub-white'));
    // The player's card is at the bottom, now White's.
    await waitFor(() => expect(screen.getByTestId('player-white').props.accessibilityLabel).toMatch(/, to play$/), { timeout: 15000 });
    expect(screen.getAllByLabelText(/black stone/)).toHaveLength(1);
    const blackStone = screen.getAllByLabelText(/black stone/)[0].props.accessibilityLabel as string;
    await point(blackStone.startsWith('E5') ? 'C3' : 'E5');
    expect(screen.getAllByLabelText(/white stone/)).toHaveLength(1);
    await tap('options');
    await tap('new-game');
    expect((await screen.findByTestId('hub-white')).props.accessibilityState.selected).toBe(true);
    await tap('hub-start');
    await tap('hub-discard');
    await waitFor(() => expect(screen.getAllByLabelText(/black stone/)).toHaveLength(1), { timeout: 15000 });
    expect(screen.queryAllByLabelText(/white stone/)).toHaveLength(0);
  });

  it('keeps the game when the app is stopped, and Continue returns to it', async () => {
    const first = await open();
    await start('human');
    await point('E5');
    await point('C3');
    await first.unmount();

    await open();
    expect(screen.getByTestId('hub-resume').props.accessibilityLabel).toBe('Continue, 9×9 · Face to face · Move 2');
    await tap('hub-resume');
    expect(label('E5')).toBe('E5, black stone');
    expect(label('C3')).toBe('C3, white stone');
  });

  it('the menu closes only once there is a game under it', async () => {
    await open();
    expect(screen.queryByTestId('hub-close')).toBeNull();
    await start('bot');
    await tap('options');
    await tap('options-hub');
    await tap('hub-close');
    expect(screen.queryByTestId('hub-play-bot')).toBeNull();
  });

  it('Options from the menu is a page of the menu, with only the settings', async () => {
    await open();
    await tap('hub-options');
    expect(screen.queryByTestId('options-sheet')).toBeNull();
    expect(screen.queryByTestId('options-resume')).toBeNull();
    await tap('sound');
    expect(screen.getByTestId('sound').props.accessibilityState).toMatchObject({ checked: false });
    await tap('hub-back');
    expect(screen.getByTestId('hub-play-bot')).toBeTruthy();
  });

  it('Rules from the menu open over it and close back to it', async () => {
    await open();
    await tap('hub-rules');
    await tap('sheet-close');
    expect(screen.getByTestId('hub-play-bot')).toBeTruthy();
  });

  it('Main menu keeps an unfinished game, without asking: Continue brings it back', async () => {
    await open();
    await start('human');
    await point('E5');
    await tap('options');
    expect(screen.getByText('9×9 · Face to face · Move 1')).toBeTruthy();
    await tap('options-hub');
    expect(await screen.findByTestId('hub-resume')).toBeTruthy();
    await tap('hub-resume');
    expect(label('E5')).toBe('E5, black stone');
  });

  it('asks before a new game replaces an unfinished one', async () => {
    const first = await open();
    await start('human');
    await point('E5');
    await first.unmount();

    const second = await open();
    await start('bot');
    expect(screen.getByText('Your current game will be lost.')).toBeTruthy();
    await pressHidden('hub-size-13');
    await pressHidden('hub-dimmed');
    expect(screen.queryByTestId('hub-replace-confirm')).toBeNull();
    expect(screen.getByTestId('hub-size-9').props.accessibilityState).toMatchObject({ selected: true });
    await tap('hub-start');
    await tap('hub-keep');
    expect(label('E5')).toBe('E5, black stone');
    await second.unmount();

    await open();
    await start('bot');
    await tap('hub-discard');
    expect(label('E5')).toBe('E5, empty');
    expect(screen.getByTestId('player-white').props.accessibilityLabel).toMatch(/^Bot/);
  });

  it('the ☰ menu’s New game opens the setup for the same kind of game, starting from its settings', async () => {
    await open();
    await start('human', async () => {
      await tap('hub-size-13');
      await tap('hub-game-settings');
      await tap('hub-handicap-more');
    });
    await point('E5');
    await tap('options');
    await tap('new-game');
    expect(await screen.findByText('Play on this device')).toBeTruthy();
    expect(screen.getByTestId('hub-size-13').props.accessibilityState.selected).toBe(true);
    expect(text('hub-handicap-value')).toBe('1 stone');
    // Starting asks first, as the unfinished game would be lost; Keep playing goes back to it.
    await tap('hub-start');
    await tap('hub-keep');
    expect(label('E5')).toBe('E5, black stone');
    await tap('options');
    await tap('new-game');
    await tap('hub-size-9');
    await tap('hub-start');
    await tap('hub-discard');
    expect(label('E5')).toBe('E5, empty');
    expect(screen.queryByTestId('pt-L11')).toBeNull();
  });

  it('Back from the setup the ☰ menu’s New game opened returns to the game with the ☰ menu open', async () => {
    await open();
    await start('human');
    await point('E5');
    await tap('options');
    await tap('new-game');
    expect(await screen.findByText('Play on this device')).toBeTruthy();
    await tap('hub-back');
    expect(await screen.findByTestId('options-sheet')).toBeTruthy();
    expect(screen.queryByText('Play on this device')).toBeNull();
    expect(label('E5')).toBe('E5, black stone');
    // A setup reached through the main menu still goes back to the main menu.
    await tap('options-hub');
    await screen.findByTestId('hub-play-bot');
    await tap('hub-play-bot');
    await tap('hub-back');
    expect(screen.getByTestId('hub-resume')).toBeTruthy();
  });

  it('while a confirmation is open, the rest steps back: its buttons do nothing, and a tap on it cancels', async () => {
    await open();
    await start('human');
    await point('E5');
    await tap('options');
    await tap('resign');
    // Main menu is out of reach while Resign asks.
    await pressHidden('options-hub');
    expect(screen.queryByTestId('hub-play-bot')).toBeNull();
    await pressHidden('options-dimmed');
    expect(screen.queryByTestId('resign-confirm')).toBeNull();
    await tap('resign');
    expect(screen.getByTestId('resign-confirm')).toBeTruthy();
    await tap('resign-cancel');
    expect(screen.queryByTestId('resign-confirm')).toBeNull();
  });

  it('a handicap game puts Black’s stones down and the bot opens as White', async () => {
    await open();
    await start('bot', async () => {
      await tap('hub-game-settings');
      await tap('hub-handicap-more');
      expect(text('hub-handicap-value')).toBe('1 stone');
      await tap('hub-handicap-more');
      expect(text('hub-handicap-value')).toBe('2 stones');
    });
    expect(label('C3')).toBe('C3, black stone');
    expect(label('G7')).toBe('G7, black stone');
    await botReplies();
    expect(screen.getAllByLabelText(/white stone/)).toHaveLength(1);
  });

  it('one stone is Black playing first on an empty board, and 9×9 takes at most five stones', async () => {
    await open();
    await start('human', async () => {
      await tap('hub-game-settings');
      await tap('hub-size-19');
      for (let i = 0; i < 9; i++) await tap('hub-handicap-more');
      expect(text('hub-handicap-value')).toBe('9 stones');
      expect(screen.getByTestId('hub-handicap-more').props.accessibilityState).toMatchObject({ disabled: true });
      await tap('hub-size-9');
      expect(text('hub-handicap-value')).toBe('5 stones');
      expect(screen.getByTestId('hub-handicap-more').props.accessibilityState).toMatchObject({ disabled: true });
      for (let i = 0; i < 4; i++) await tap('hub-handicap-less');
      expect(text('hub-handicap-value')).toBe('1 stone');
    });
    expect(screen.queryAllByLabelText(/black stone/)).toHaveLength(0);
    await point('E5');
    expect(label('E5')).toBe('E5, black stone');
  });

  it('tap twice is on for a new player on every board: the first tap previews, the second places', async () => {
    localStorage.removeItem('go.confirmMoves');
    await open();
    await tap('hub-options');
    expect(screen.getByTestId('confirm-moves').props.accessibilityState).toEqual({ checked: true });
    await tap('hub-back');
    // The setup leaves it to Settings.
    await start('human', async () => {
      expect(screen.queryByTestId('hub-confirm')).toBeNull();
    });
    await point('D4');
    expect(screen.getAllByText('Tap again to place the stone').length).toBeGreaterThan(0);
    expect(label('D4')).toBe('D4, empty');
    await point('D4');
    expect(label('D4')).toBe('D4, black stone');
  });

  it('with tap twice, a drag leaves the preview where it ends, and a tap there places the stone', async () => {
    localStorage.setItem('go.confirmMoves', 'on');
    await open();
    await start('human', async () => {
      await tap('hub-size-19');
    });
    const at = (name: string) => {
      const { left, top, width } = StyleSheet.flatten(screen.getByTestId(`pt-${name}`).props.style);
      return { nativeEvent: { pageX: left + width / 2, pageY: top + width / 2 } };
    };
    const board = () => screen.getByTestId('board');
    await fireEvent(board(), 'responderGrant', at('C3'));
    await fireEvent(board(), 'responderMove', at('E5'));
    await fireEvent(board(), 'responderMove', at('G7'));
    await fireEvent(board(), 'responderRelease', at('G7'));
    expect(screen.getAllByText('Tap again to place the stone').length).toBeGreaterThan(0);
    expect(label('G7')).toBe('G7, empty');
    await act(() => new Promise((r) => setTimeout(r, 300)));
    await fireEvent(board(), 'responderGrant', at('G7'));
    await fireEvent(board(), 'responderRelease', at('G7'));
    expect(label('G7')).toBe('G7, black stone');
  });

  it('without tap twice, a slide aims at once and places where the finger lifts; the board keeps a finger it aims with', async () => {
    await open();
    await start('human');
    const at = (name: string) => {
      const { left, top, width } = StyleSheet.flatten(screen.getByTestId(`pt-${name}`).props.style);
      return { nativeEvent: { pageX: left + width / 2, pageY: top + width / 2 } };
    };
    const board = () => screen.getByTestId('board');
    await fireEvent(board(), 'responderGrant', at('C3'));
    // A finger that has only landed may still go to a scroll view; once it slides, the board keeps it.
    expect(board().props.onResponderTerminationRequest()).toBe(true);
    await fireEvent(board(), 'responderMove', at('E5'));
    expect(board().props.onResponderTerminationRequest()).toBe(false);
    await fireEvent(board(), 'responderRelease', at('E5'));
    expect(label('C3')).toBe('C3, empty');
    expect(label('E5')).toBe('E5, black stone');
  });

  it('a touch the system takes away places nothing, even while aiming', async () => {
    await open();
    await start('human');
    const at = (name: string) => {
      const { left, top, width } = StyleSheet.flatten(screen.getByTestId(`pt-${name}`).props.style);
      return { nativeEvent: { pageX: left + width / 2, pageY: top + width / 2 } };
    };
    await fireEvent(screen.getByTestId('board'), 'responderGrant', at('C3'));
    await fireEvent(screen.getByTestId('board'), 'responderMove', at('D4'));
    await fireEvent(screen.getByTestId('board'), 'responderTerminate');
    expect(label('D4')).toBe('D4, empty');
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/, to play$/);
  });

  it('the beginner game is offered to players new to Go: 9×9, with the Coach and Territory switched on', async () => {
    await open();
    await tap('hub-play-bot');
    expect(screen.queryByTestId('hub-beginner')).toBeNull();
    localStorage.setItem('go.profile', JSON.stringify({ name: 'Jane Doe', level: 'never', rating: -900, games: 0 }));
    await open();
    await tap('hub-play-bot');
    await tap('hub-beginner');
    expect(screen.getByTestId('pt-J9')).toBeTruthy();
    expect(screen.queryByTestId('pt-K10')).toBeNull();
    await tap('guide');
    for (const id of ['quick-teaching', 'quick-territory'])
      expect(screen.getByTestId(id).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('quick-likely').props.accessibilityState).toMatchObject({ checked: false });
  });
});

describe('face to face', () => {
  it('each end has its own row: Pass only for the player to move, Guide and Options only at Black’s end', async () => {
    await open();
    await start('human');
    expect(screen.getByTestId('pass').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId('pass-top').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.queryByTestId('options-top')).toBeNull();
    expect(screen.queryByTestId('guide-top')).toBeNull();
    expect(screen.getAllByTestId('options')).toHaveLength(1);
    expect(screen.queryByTestId('guide')).toBeNull();
    // Liberties and Territory are shared by both players and switched in the settings, opened from Black's Options.
    await openFacingSettings();
    await tap('quick-liberties');
    expect(screen.getByTestId('quick-liberties').props.accessibilityState).toMatchObject({ checked: true });
    await closeFacingSettings();
    await point('D5');
    expect(label('D5')).toBe('D5, black stone');
    await tap('undo-top');
    expect(label('D5')).toBe('D5, empty');
  });

  it('explains refused moves, counts captures and refuses taking a ko back at once', async () => {
    await open();
    await start('human');
    for (const p of ['D5', 'E5', 'F5', 'A1', 'E6', 'A2']) await point(p);
    await point('E4');
    // Under area scoring captures don't count, so the card keeps no tally of them.
    expect(screen.getByTestId('player-black').props.accessibilityLabel).not.toMatch(/Captured/);
    expect(label('E5')).toBe('E5, empty');
    await point('D5');
    // Said in a note over the board that fades, not a message that stays beside it.
    expect(within(screen.getByTestId('board-note')).getByText('There’s already a stone there.')).toBeTruthy();
    expect(screen.queryByTestId('status')).toBeNull();
    // A second refusal right after the first replaces its note.
    await point('E5');
    expect(within(screen.getByTestId('board-note')).getByText('That stone would be captured right away. Try another spot.')).toBeTruthy();
  });

  it('face to face, a pass is told to both players, each the right way up at their end', async () => {
    await open();
    await start('human');
    await passAnyway('pass');
    expect(within(screen.getByTestId('board-note')).getByText('Black passed')).toBeTruthy();
    // The copy for White is hidden from screen readers, so the pass is announced once.
    const forWhite = screen.getByTestId('board-note-top', { includeHiddenElements: true });
    expect(within(forWhite).getByText('Black passed', { includeHiddenElements: true })).toBeTruthy();
  });

  it('the second pass tells both players the game is over before the stones are marked', async () => {
    await open();
    await start('human');
    await passAnyway('pass');
    await passAnyway('pass-top');
    const note = screen.getByTestId('board-note');
    expect(within(note).getByText('Game over')).toBeTruthy();
    expect(within(note).getByText('Both players passed')).toBeTruthy();
    const forWhite = screen.getByTestId('board-note-top', { includeHiddenElements: true });
    expect(within(forWhite).getByText('Game over', { includeHiddenElements: true })).toBeTruthy();
  });

  it('a note from the last game does not show again in the next one', async () => {
    await open();
    await start('human');
    await passAnyway('pass');
    expect(within(screen.getByTestId('board-note')).getByText('Black passed')).toBeTruthy();
    await tap('options');
    await toMainMenu();
    await startOver('bot');
    expect(screen.queryByTestId('board-note')).toBeNull();
  });

  it('two passes stop at the review; Count counts, and the result shows the winner', async () => {
    await open();
    await start('human');
    await point('E5');
    await point('A1');
    await passAnyway('pass');
    await passAnyway('pass-top');
    // Two lone stones on an open board: the app can only guess, and says so.
    expect(text('status')).toBe('Tap a ? group to decide, or keep playing to settle it.');
    expect(screen.getByTestId('marking-legend').props.accessibilityLabel).toMatch(/Might escape$/);
    expect(label('A1')).toMatch(/, not sure$/);
    if (!label('A1').includes('marked dead')) await point('A1');
    expect(label('A1')).toBe('A1, white stone, marked dead');
    await tap('accept');
    expect(screen.getByTestId('count-legend').props.accessibilityLabel).toMatch(/^Taken off, /);
    if (screen.queryByTestId('count-skip')) await tap('count-skip');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    // Counted, the dead stone has come off the board.
    expect(label('A1')).toMatch(/^A1, empty/);
    expect(text('result-title')).toMatch(/^(Black|White) wins!$/);
    expect(text('result-subtitle')).toMatch(/^by .* points$/);

    // Face to face, ◀◀ goes back through the count one step at a time, and before its first step to marking the stones.
    expect(screen.queryByTestId('fix-dead-result')).toBeNull();
    await tap('count-replay');
    expect(text('status')).toMatch(/^Counting · step (\d+) of \1$/);
    while (screen.getByTestId('count-back').props.accessibilityLabel === 'Previous step') await tap('count-back');
    expect(screen.getByTestId('count-back').props.accessibilityLabel).toBe('Back to marking the stones');
    await tap('count-back');
    expect(text('status')).toMatch(/^(Check the ✕ stones|Tap a \? group|No stones marked)/);
  });

  it('the count takes dead stones of both colours off in one step, and moves on only once they have flown off', async () => {
    await open();
    await start('human');
    for (const p of ['E5', 'E4', 'A1', 'J9']) await point(p);
    await passAnyway('pass');
    await passAnyway('pass-top');
    for (const p of ['A1', 'J9']) for (let i = 0; i < 3 && !/marked dead$/.test(label(p)); i++) await point(p);
    expect(label('A1')).toBe('A1, black stone, marked dead');
    expect(label('J9')).toBe('J9, white stone, marked dead');
    await tap('accept');
    await tap('count-next');
    const total = /^Counting · step 1 of (\d+)$/.exec(text('status'))?.[1];
    expect(total).toBeDefined();
    // Ringed first, both colours in the one step.
    expect(label('A1')).toMatch(/^A1, black stone/);
    expect(label('J9')).toMatch(/^J9, white stone/);
    // ▶▶ sends them off at once; the count stays on this step until they have landed.
    await tap('count-next');
    expect(label('A1')).toMatch(/^A1, empty/);
    expect(label('J9')).toMatch(/^J9, empty/);
    expect(text('status')).toBe(`Counting · step 1 of ${total}`);
    await waitFor(() => expect(text('status')).toBe(`Counting · step 2 of ${total}`), { timeout: 5000 });
  });

  it('a quick second tap on Count does not reach the count’s own buttons', async () => {
    await open();
    await start('human');
    await passAnyway('pass');
    await passAnyway('pass-top');
    await tap('accept');
    expect(text('status')).toBe('Tap Watch, or ▶▶ to go step by step.');
    // The same moment as Count: a double tap.
    await fireEvent.press(screen.getByTestId('count-next'));
    expect(text('status')).toBe('Tap Watch, or ▶▶ to go step by step.');
    await tap('count-next');
    expect(text('status')).toMatch(/^Counting · step 1 of/);
  });

  it('passing with much of the board open asks for a second tap first', async () => {
    await open();
    await start('human');
    await point('E5');
    await tap('pass-top');
    expect(text('status-top')).toBe('There’s still open space to claim. Tap Pass again to pass anyway.');
    expect(screen.getByTestId('player-white').props.accessibilityLabel).toMatch(/, to play$/);
    await tap('pass-top');
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/, to play$/);
  });

  it('with no stones marked, the marking says so instead of describing the ✕', async () => {
    await open();
    await start('human');
    await point('C3');
    await point('G7');
    await passAnyway('pass');
    await passAnyway('pass-top');
    for (const p of ['C3', 'G7']) {
      for (let i = 0; i < 3 && /marked dead|not sure/.test(label(p)); i++) await point(p);
    }
    expect(text('status')).toBe('No stones marked. Tap a group that can’t escape, or tap Count.');
    expect(screen.queryByTestId('marking-legend')).toBeNull();
  });

  it('with reduce motion on, sheets open in place without sliding up', async () => {
    const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await open();
    await start('human');
    await tap('options');
    const style = StyleSheet.flatten(screen.getByTestId('options-sheet').props.style);
    expect(style.transform).toEqual([{ translateY: 0 }, { scale: 1 }]);
    reduce.mockResolvedValue(false);
  });

  it('passing at once leaves no stones to mark, and nothing to fix after the count', async () => {
    await open();
    await start('human');
    await passAnyway('pass');
    await passAnyway('pass-top');
    expect(text('status')).toBe('No stones to take off. Tap Count to count the score.');
    await tap('accept');
    if (screen.queryByTestId('count-skip')) await tap('count-skip');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    expect(screen.queryByTestId('fix-dead-result')).toBeNull();
    expect(screen.queryByTestId('fix-dead')).toBeNull();
  });

  it('resigning asks once more; the player to move resigns', async () => {
    await open();
    await start('human');
    await tap('options');
    await tap('resign');
    expect(screen.getByText('Resign? Black will lose this game.')).toBeTruthy();
    await tap('resign-yes');
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    expect(text('result-subtitle')).toBe('Black resigned');
  });
});

describe('teaching and the board', () => {
  it('the Coach says why the strongest move is good, and notes a ko but not a plain capture', async () => {
    jest.mocked(evaluateNet).mockImplementation(netFavouring('E4'));
    await open();
    await start('human');
    await openFacingSettings();
    await tap('quick-teaching');
    await closeFacingSettings();
    await screen.findByLabelText('The strongest move here.');
    // Face to face there is no room for the tutorial frame.
    expect(screen.queryByTestId('guide-frame')).toBeNull();
    for (const p of ['D5', 'E5', 'F5', 'A1', 'E6']) await point(p);
    // E6 leaves White's stone with one liberty: the board's liberties show it, so no note does.
    expect(screen.queryByTestId('guide-note')).toBeNull();
    await point('A2');
    // On Black's turn the stone is a capture for Black, and the strongest move says so.
    const idea = await screen.findByLabelText('The strongest move here. You can capture a stone.');
    expect(label('E4')).toBe('E4, empty, suggested: Strongest move');
    // Tapping the idea marks it on the board, still as the idea, without playing it.
    await fireEvent.press(idea);
    expect(screen.getByLabelText('The strongest move here. You can capture a stone.').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(label('E4')).toBe('E4, empty, suggested: Strongest move');
    // The capture shows on the board by itself, so no note floats up.
    await point('E4');
    expect(label('E5')).toBe('E5, empty');
    expect(screen.queryByTestId('guide-note')).toBeNull();
    // White takes F5 back in a ko.
    for (const p of ['G5', 'A9', 'F6', 'B9', 'F4', 'C9', 'E5']) await point(p);
    expect(screen.getByTestId('guide-note').props.accessibilityLabel).toBe('Ko! It can’t be taken back right away');
  });

  it('playing into atari gets no note: the board shows it', async () => {
    localStorage.setItem('go.teaching', 'on');
    jest.mocked(evaluateNet).mockImplementation(netFavouring('A1'));
    await open();
    await start('bot');
    await point('B1');
    await botReplies();
    await act(() => new Promise((r) => setTimeout(r, 300)));
    // The bot's A1 has one liberty left.
    expect(label('A1')).toMatch(/white/);
    expect(screen.queryByTestId('guide-note')).toBeNull();
  });

  it('the Coach shows the network’s strongest move, outlines open stones and prices the last move', async () => {
    // A network that sees every stone's fate open and the player to move 2 points ahead, whoever that is.
    jest.mocked(evaluateNet).mockImplementation(async (_name, size) => ({ ...fakeNet(size), score: [0.1] }));
    await open();
    await start('human');
    await openFacingSettings();
    await tap('quick-teaching');
    await closeFacingSettings();
    await screen.findByLabelText('The strongest move here.');
    expect(label('C3')).toBe('C3, empty, suggested: Strongest move');
    await point('E5');
    await waitFor(() => expect(screen.getByTestId('outline-weak-E5')).toBeTruthy());
    expect(screen.getByTestId('outline-legend')).toBeTruthy();
    expect(screen.getByText('Weak stones: they could still live or die')).toBeTruthy();
    await point('A1');
    // Black's E5 left White 2 points ahead where Black had been 2 ahead. C3, stronger then, is still the move shown.
    await screen.findByText('Your last move cost about 4 points. The move shown was stronger, and still is.');
    expect(screen.getByLabelText('The strongest move here.')).toBeTruthy();
    // Switched off, the board and the band are plain again.
    await openFacingSettings();
    await tap('quick-teaching');
    await closeFacingSettings();
    expect(screen.queryByTestId('outline-legend')).toBeNull();
    expect(screen.queryByTestId('outline-weak-E5')).toBeNull();
    expect(screen.queryByLabelText('The strongest move here.')).toBeNull();
    expect(label('C3')).toBe('C3, empty');
  });

  it('the score estimate shows on the cards who the game seems headed for, without squares on the board', async () => {
    await open();
    await start('human');
    await openFacingSettings();
    await tap('quick-estimate');
    await tap('quick-territory');
    await closeFacingSettings();
    for (const p of ['C3', 'G7', 'C7', 'G3', 'D5']) await point(p);
    await waitFor(() => expect(screen.getByTestId('estimate-black')).toBeTruthy(), { timeout: 15000 });
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/, about \d+½? points/);
    expect(text('estimate-white')).toMatch(/^≈ \d+½?$/);
    // Exactly one card says it leads, unless the estimate is a tie.
    const leading = ['black', 'white'].filter((c) => screen.getByTestId(`player-${c}`).props.accessibilityLabel.includes(', leading'));
    expect(leading.length).toBeLessThanOrEqual(1);
    // Territory marks only fenced areas; the likely ones are a choice of their own.
    expect(screen.queryByTestId('projected-black') ?? screen.queryByTestId('projected-white')).toBeNull();
  });

  it('likely areas shows where the estimate expects each player to end up, without the score on the cards', async () => {
    await open();
    await start('human');
    await openFacingSettings();
    await tap('quick-likely');
    await closeFacingSettings();
    expect(localStorage.getItem('go.likelyAreas')).toBe('on');
    for (const p of ['C3', 'G7', 'C7', 'G3', 'D5']) await point(p);
    await waitFor(() => expect(screen.queryByTestId('projected-black') ?? screen.queryByTestId('projected-white')).toBeTruthy(), {
      timeout: 15000,
    });
    expect(screen.queryByTestId('estimate-black')).toBeNull();
    expect(screen.queryByTestId('estimate-white')).toBeNull();
  });

  it('a ghost stone’s point is left clear of the estimate’s squares', async () => {
    jest.mocked(evaluateNet).mockImplementation(netFavouring('E4'));
    await open();
    await start('human');
    await openFacingSettings();
    await tap('quick-likely');
    await closeFacingSettings();
    for (const p of ['D5', 'E5', 'F5', 'A1', 'E6', 'A2']) await point(p);
    const squares = () => (String(screen.getByTestId('projected-black').props.d).match(/M/g) ?? []).length;
    await waitFor(() => expect(screen.getByTestId('projected-black')).toBeTruthy(), { timeout: 15000 });
    // The first look comes early; give the full estimate time to land before measuring.
    await act(() => new Promise((r) => setTimeout(r, 1500)));
    const without = squares();
    await openFacingSettings();
    await tap('quick-teaching');
    await closeFacingSettings();
    await waitFor(() => expect(label('E4')).toBe('E4, empty, suggested: Strongest move'));
    expect(squares()).toBe(without - 1);
  });

  it('territory while playing marks a point only Black surrounds', async () => {
    await open();
    await start('human');
    for (const p of ['D5', 'A9', 'F5', 'A8', 'E6', 'A7', 'E4']) await point(p);
    await openFacingSettings();
    await tap('quick-territory');
    await closeFacingSettings();
    expect(label('E5')).toBe('E5, empty, Black area');
  });

  it('a ko cannot be taken back at once', async () => {
    await open();
    await start('human');
    for (const p of ['D5', 'E5', 'F5', 'G5', 'E6', 'F6', 'E4', 'F4', 'A1']) await point(p);
    await point('E5');
    expect(label('F5')).toBe('F5, empty');
    await point('F5');
    expect(screen.getAllByText(/^Not yet! That would just undo the last capture/).length).toBeGreaterThan(0);
  });

  it('against the bot, the legend stays with the result of a game counted on screen', async () => {
    // A game against the bot that both players have passed: E5, the bot's C7, then two passes.
    localStorage.setItem(
      'go.currentGame',
      JSON.stringify({ v: 1, settings: { size: 9, opponent: 'ai', humanColor: 'black', handicap: 0 }, moves: [40, 20, -1, -1], dead: [] }),
    );
    await open();
    await tap('hub-resume');
    await tap('accept');
    await tap('count-skip');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    expect(screen.getByTestId('count-legend').props.accessibilityLabel).toBe('Black points, White points, ½ each, +7½ komi');
  });

  it('Groups joins neighbouring stones of one colour, and is remembered', async () => {
    await open();
    await start('human');
    for (const p of ['C3', 'G7', 'D3']) await point(p);
    expect(screen.queryByTestId('groups-black')).toBeNull();
    await openFacingSettings();
    await tap('quick-groups');
    await closeFacingSettings();
    expect(screen.getByTestId('groups-black')).toBeTruthy();
    expect(screen.queryByTestId('groups-white')).toBeNull();
    expect(localStorage.getItem('go.groups')).toBe('on');
  });

  it('with Liberties on, holding a stone shows its group’s liberties, Teaching or not, and places nothing', async () => {
    await open();
    await start('human');
    for (const p of ['C3', 'G7', 'D3']) await point(p);
    await openFacingSettings();
    await tap('quick-liberties');
    await closeFacingSettings();
    const { left, top, width } = StyleSheet.flatten(screen.getByTestId('pt-D3').props.style);
    const at = { nativeEvent: { pageX: left + width / 2, pageY: top + width / 2 } };
    await fireEvent(screen.getByTestId('board'), 'responderGrant', at);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    // C3 and D3 together: B3, E3, C4, D4, C2 and D2.
    expect(screen.getByText('6 liberties')).toBeTruthy();
    await fireEvent(screen.getByTestId('board'), 'responderRelease', at);
    expect(screen.getByTestId('player-white').props.accessibilityLabel).toMatch(/, to play$/);
  });

  it('against the bot, one Guide button opens the Guide’s switches, and each changes the board', async () => {
    await open();
    await start('bot');
    expect(screen.queryByTestId('liberties')).toBeNull();
    expect(screen.queryByTestId('territory-quick')).toBeNull();
    await point('E5');
    await botReplies();
    await tap('guide');
    for (const id of ['quick-teaching', 'quick-liberties', 'quick-groups', 'quick-territory', 'quick-likely', 'quick-estimate'])
      expect(screen.getByTestId(id).props.accessibilityState).toMatchObject({ checked: false });
    await tap('quick-liberties');
    expect(screen.getByTestId('quick-liberties').props.accessibilityState).toMatchObject({ checked: true });
    expect(localStorage.getItem('go.liberties')).toBe('on');
    await tap('sheet-close');
    // The same choice is on the main menu's Options page.
    await tap('options');
    await toMainMenu();
    await tap('hub-options');
    expect(screen.getByTestId('show-liberties').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('the top-right menu is laid out like the main menu: Rules, Feedback and Settings, but no switches and no licence line', async () => {
    await open();
    await start('bot');
    expect(screen.queryByTestId('options-sheet')).toBeNull();
    await tap('options');
    expect(screen.getByTestId('options-sheet')).toBeTruthy();
    for (const id of ['options-resume', 'new-game', 'resign', 'options-hub', 'help', 'feedback', 'options-settings'])
      expect(screen.getByTestId(id)).toBeTruthy();
    for (const id of ['sound', 'close-options', 'quick-liberties', 'opt-lang-fi', 'version']) expect(screen.queryByTestId(id)).toBeNull();
    await tap('help');
    await tap('sheet-close');
    await tap('options');
    await tap('options-resume');
    expect(screen.queryByTestId('options-sheet')).toBeNull();
  });

  it('Settings opened from the top-right menu closes back to the game', async () => {
    await open();
    await start('human');
    await tap('options');
    await tap('options-settings');
    expect(await screen.findByTestId('guide-sheet')).toBeTruthy();
    expect(screen.queryByTestId('options-sheet')).toBeNull();
    await tap('sheet-close');
    expect(screen.queryByTestId('guide-sheet')).toBeNull();
    expect(screen.queryByTestId('options-sheet')).toBeNull();
  });

  it('against the bot, the Settings sheet closes with the X, not a back arrow', async () => {
    await open();
    await start('bot');
    await tap('guide');
    await tap('sheet-close');
    expect(screen.queryByTestId('guide-sheet')).toBeNull();
  });

  it('the Settings sheet is the main menu’s Settings page: board and sound, play, the hints with the Coach, and language', async () => {
    await open();
    await start('bot');
    await tap('guide');
    const sheet = within(screen.getByTestId('guide-sheet'));
    const titles = ['Board and sound', 'Play', 'Hints', 'Language'];
    for (const title of ['Settings', ...titles]) expect(sheet.getByText(title)).toBeTruthy();
    // Sound and the board come first; the hints run from the lightest to the Coach, which stops a game being rated.
    const order = sheet
      .getAllByText(new RegExp(`^(${titles.join('|')}|Liberties|Score estimate|Show the Coach)$`))
      .map((n) => n.props.children);
    expect(order).toEqual(['Board and sound', 'Play', 'Hints', 'Liberties', 'Score estimate', 'Show the Coach', 'Language']);
    expect(screen.queryByTestId('quick-helps')).toBeNull();
    for (const id of [
      'quick-teaching',
      'sound',
      'vibration',
      'confirm-moves',
      'count-steps',
      'coordinates',
      'star-points',
      'opt-lang-phone',
      'opt-lang-fi',
    ])
      expect(screen.getByTestId(id)).toBeTruthy();
    await tap('sound');
    expect(screen.getByTestId('sound').props.accessibilityState).toMatchObject({ checked: false });
    await tap('sheet-close');
  });

  it('the count can be paused and shows what the marks mean', async () => {
    await open();
    await start('human');
    await point('E5');
    await passAnyway('pass-top');
    await passAnyway('pass');
    await tap('accept');
    await tap('count-play');
    // Nothing is taken off in this game, so the legend has no cross.
    expect(screen.getByTestId('count-legend').props.accessibilityLabel).toBe('Black points, White points, +7½ komi');
    await tap('count-skip');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
  });

  it('points between both players’ stones count half for each, as the Chinese rules have it', async () => {
    await open();
    await start('human');
    await point('E5');
    await point('E4');
    await passAnyway('pass');
    await passAnyway('pass-top');
    await tap('accept');
    await tap('count-skip');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    // The 79 empty points all touch both colours: 39½ each.
    expect(screen.getByTestId('breakdown-black').props.accessibilityLabel).toBe('Black: 1 stone + 0 territory + 39½ shared = 40½');
    expect(screen.getByTestId('breakdown-white').props.accessibilityLabel).toBe('White: 1 stone + 0 territory + 39½ shared + 7½ komi = 48');
  });

  it('counting step by step, the count reveals the score; the result sits under the board, and New game starts anew', async () => {
    await open();
    await start('human');
    await point('E5');
    await passAnyway('pass-top');
    await passAnyway('pass');
    expect(screen.queryByTestId('detail-black')).toBeNull();
    expect(screen.queryByTestId('score-breakdown')).toBeNull();
    await tap('accept');
    await tap('count-skip');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    expect(screen.getByTestId('breakdown-black').props.accessibilityLabel).toBe('Black: 1 stone + 80 territory = 81');
    // Each end shows both scores, its own first.
    expect(screen.getByTestId('breakdown-white').props.accessibilityLabel).toBe('White: 0 stones + 0 territory + 7½ komi = 7½');
    expect(screen.getByTestId('breakdown-black-top').props.accessibilityLabel).toBe('Black: 1 stone + 80 territory = 81');
    expect(screen.queryByTestId('view-board')).toBeNull();

    // ◀◀ on the result goes back to the count's last step, paused, with komi added and the areas shown.
    expect(screen.getByTestId('count-replay').props.accessibilityLabel).toBe('Previous step');
    await tap('count-replay');
    expect(screen.queryByTestId('result-card')).toBeNull();
    expect(text('status')).toBe('Counting · step 4 of 4');
    expect(screen.getByTestId('area-black')).toBeTruthy();
    await tap('count-next');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    // One button starts the next game, with the same settings.
    expect(screen.getByTestId('rematch').props.accessibilityLabel).toBe('New game');
    expect(screen.queryByTestId('rematch-suggested')).toBeNull();
    await tap('rematch');
    expect(label('E5')).toBe('E5, empty');
    expect(screen.queryByTestId('result-card')).toBeNull();
  });

  it('the count waits, keeps point squares through each step and the result, and adds komi last', async () => {
    await open();
    await start('human');
    await point('E5');
    await passAnyway('pass-top');
    await passAnyway('pass');
    await tap('accept');
    await act(() => new Promise((r) => setTimeout(r, 1500)));
    expect(text('status')).toBe('Tap Watch, or ▶▶ to go step by step.');
    const whiteScore = () => screen.getByTestId('breakdown-white').props.accessibilityLabel as string;
    expect(screen.queryAllByTestId(/^point-squares-/)).toHaveLength(0);
    // Each step keeps the earlier squares; stepping back before the first removes them.
    await tap('count-next');
    expect(screen.queryAllByTestId(/^point-squares-black-/).length).toBeGreaterThan(0);
    await tap('count-back');
    expect(screen.queryAllByTestId(/^point-squares-/)).toHaveLength(0);
    // Black's stone, Black's territory, White's komi in its own step, then the areas filled in their colours.
    for (let i = 1; i <= 2; i++) {
      await tap('count-next');
      expect(text('status')).toBe(`Counting · step ${i} of 4`);
      expect(screen.queryAllByTestId(/^point-squares-black-/).length).toBeGreaterThan(0);
    }
    expect(whiteScore()).not.toContain('7½');
    await tap('count-next');
    expect(text('status')).toBe('Counting · step 3 of 4');
    expect(whiteScore()).toContain('7½');
    expect(screen.queryByTestId('area-black')).toBeNull();
    expect(screen.queryAllByTestId(/^point-squares-black-/).length).toBeGreaterThan(0);
    await tap('count-next');
    expect(text('status')).toBe('Counting · step 4 of 4');
    expect(screen.getByTestId('area-black')).toBeTruthy();
    expect(screen.queryByTestId('area-white')).toBeNull();
    expect(screen.queryAllByTestId(/^point-squares-/)).toHaveLength(0);
    expect(whiteScore()).toContain('7½');
    await tap('count-next');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    expect(screen.queryByTestId('area-black')).toBeNull();
    expect(screen.queryAllByTestId(/^point-squares-black-/).length).toBeGreaterThan(0);
  });

  it('a quick second tap as the count ends does not start a new game', async () => {
    await open();
    await start('human');
    await point('E5');
    await passAnyway('pass-top');
    await passAnyway('pass');
    await tap('accept');
    await tap('count-skip');
    clock -= 900;
    await tap('rematch');
    expect(label('E5')).toBe('E5, black stone');
    expect(screen.getByTestId('result-card')).toBeTruthy();
  });

  it('with step by step off, marking shows the score and Count shows the result at once', async () => {
    localStorage.setItem('go.countSteps', 'off');
    await open();
    await start('human');
    await point('E5');
    await passAnyway('pass-top');
    await passAnyway('pass');
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/Score 81/);
    expect(screen.getByTestId('score-breakdown')).toBeTruthy();
    await tap('accept');
    expect(screen.queryByTestId('count-skip')).toBeNull();
    expect(await screen.findByTestId('result-card')).toBeTruthy();
  });
});

describe('layout', () => {
  const boardAreaHeight = (height: number) =>
    fireEvent(screen.getByTestId('board-area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 750, height } } });
  const boardStyle = () => screen.getByTestId('board').props.style;

  it('the board takes the full width while both cards and a message keep their room', async () => {
    await open();
    await start('bot');
    // The test window is 750 wide: the board fills it but for a 3 dp gutter on each side.
    await boardAreaHeight(900);
    expect(boardStyle()).toContainEqual({ width: 744, height: 750 });
    // Shorter: the opponent's card above the board, your card and a band that keeps 46 dp below it, with 6 dp gaps
    // (one more for the spacer that centres them when Teaching is off); the board's edge is 6 dp.
    const cardHeight = { nativeEvent: { layout: { x: 0, y: 0, width: 750, height: 48 } } };
    await fireEvent(screen.getByTestId('their-card'), 'layout', cardHeight);
    await fireEvent(screen.getByTestId('your-card'), 'layout', cardHeight);
    await boardAreaHeight(600);
    expect(boardStyle()).toContainEqual({ width: 428, height: 434 });
  });

  it('on a tablet in portrait the board is full width too', async () => {
    const phone = Dimensions.get('window');
    const tablet = { width: 800, height: 1280, scale: 2, fontScale: 1 };
    try {
      await act(async () => Dimensions.set({ window: tablet, screen: tablet }));
      await open();
      await start('bot');
      await boardAreaHeight(1100);
      expect(boardStyle()).toContainEqual({ width: 794, height: 800 });
    } finally {
      await act(async () => Dimensions.set({ window: phone, screen: phone }));
    }
  });

  it('face to face, each end keeps room for its own message', async () => {
    await open();
    await start('human');
    await boardAreaHeight(600);
    expect(boardStyle()).toContainEqual({ width: 490, height: 496 });
  });
});

describe('options and profile', () => {
  it.each(['black', 'white'] as const)('your %s avatar opens Profile and saves back to the same game', async (color) => {
    await open();
    await start('bot', color === 'white' ? () => tap('hub-white') : null);
    const other = color === 'black' ? 'white' : 'black';
    // The bot's picture opens what it is like instead.
    expect(screen.getByTestId(`profile-${other}`).props.accessibilityLabel).toBe('About the bot');
    expect(screen.getByTestId(`profile-${color}`).props.accessibilityLabel).toBe('Profile');
    await tap(`profile-${color}`);
    expect(screen.getByTestId('hub-player-name')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), 'Jane Roe');
    await tap('hub-avatar-5');
    await tap('hub-back');
    expect(screen.queryByTestId('hub-player-name')).toBeNull();
    expect(screen.queryByTestId('hub-play-bot')).toBeNull();
    expect(text(`avatar-${color}`)).toBe('🦊');
    expect(screen.getByTestId(`player-${color}`).props.accessibilityLabel).toMatch(/^Jane Roe/);
    await tap(`profile-${color}`);
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), 'Richard Roe');
    await fireEvent(screen.getByTestId('hub-player-name'), 'requestClose');
    expect(screen.getByTestId(`player-${color}`).props.accessibilityLabel).toMatch(/^Richard Roe/);
    expect(screen.queryByTestId('hub-player-name')).toBeNull();
  });

  it('Vibration can be turned off on its own; sound stays on', async () => {
    await open();
    await start('human');
    // The vibrator, not Android's touch-feedback effects, which phones silence with their touch-vibration setting.
    const haptics = jest.mocked(impactAsync);
    await point('E5');
    expect(haptics).toHaveBeenCalled();
    await openFacingSettings();
    await tap('vibration');
    expect(screen.getByTestId('sound').props.accessibilityState).toMatchObject({ checked: true });
    await closeFacingSettings();
    haptics.mockClear();
    await point('C3');
    expect(label('C3')).toBe('C3, white stone');
    expect(haptics).not.toHaveBeenCalled();
    expect(localStorage.getItem('go.vibration')).toBe('off');
  });

  it('coordinates are off on 9×9 and on for larger boards; each size keeps its own choice', async () => {
    await open();
    await start('human');
    await openFacingSettings();
    expect(screen.getByTestId('coordinates').props.accessibilityState).toMatchObject({ checked: false });
    await closeFacingSettings();
    await tap('options');
    await toMainMenu();
    await startOver('human', () => tap('hub-size-13'));
    await openFacingSettings();
    expect(screen.getByTestId('coordinates').props.accessibilityState).toMatchObject({ checked: true });
    await tap('coordinates');
    expect(screen.getByTestId('coordinates').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('the coordinates choice for each size is remembered for the next start', async () => {
    localStorage.setItem('go.coordinates', JSON.stringify({ 19: false }));
    await open();
    await start('human', () => tap('hub-size-13'));
    await openFacingSettings();
    await tap('coordinates');
    expect(JSON.parse(localStorage.getItem('go.coordinates')!)).toEqual({ 13: false, 19: false });
    await closeFacingSettings();
    await tap('options');
    await toMainMenu();
    await startOver('human', () => tap('hub-size-19'));
    await openFacingSettings();
    expect(screen.getByTestId('coordinates').props.accessibilityState).toMatchObject({ checked: false });
  });

  /** Welcomes Jane Doe at `level` on a phone that kept choices from an earlier install, and opens a game's Guide sheet. */
  async function welcomedAt(level: string) {
    localStorage.removeItem('go.profile');
    for (const key of ['go.teaching', 'go.liberties', 'go.territory', 'go.likelyAreas', 'go.showRanks']) localStorage.setItem(key, 'on');
    localStorage.setItem('go.starPoints', 'off');
    await open();
    await fireEvent.changeText(screen.getByTestId('welcome-name'), 'Jane Doe');
    await tap(`welcome-level-${level}`);
    await tap('welcome-done');
    await start('bot');
    await tap('guide');
    return (id: string) => screen.getByTestId(id).props.accessibilityState.checked as boolean;
  }

  it('the welcome starts the choices from the level: some helps for beginners, ranks for experienced players', async () => {
    const casual = await welcomedAt('casual');
    expect(['quick-territory', 'quick-likely', 'quick-estimate', 'confirm-moves', 'star-points'].every(casual)).toBe(true);
    expect(['quick-teaching', 'quick-liberties', 'show-ranks'].some(casual)).toBe(false);
    const never = await welcomedAt('never');
    expect(['quick-territory', 'quick-likely', 'quick-estimate'].every(never)).toBe(true);
    // The Coach helps a lot, so even the newest players get it only with the beginner game.
    expect(never('quick-teaching')).toBe(false);
    expect(never('show-ranks')).toBe(false);
    const club = await welcomedAt('club');
    expect(club('show-ranks')).toBe(true);
    expect(['quick-teaching', 'quick-territory', 'quick-likely', 'quick-estimate', 'quick-liberties'].some(club)).toBe(false);
  });

  it('the welcome keeps a language chosen on it', async () => {
    localStorage.removeItem('go.profile');
    await open();
    await tap('welcome-lang-fi');
    await fireEvent.changeText(screen.getByTestId('welcome-name'), 'Jane Doe');
    await tap('welcome-level-casual');
    await tap('welcome-done');
    expect(language()).toBe('fi');
  });

  it('a first start asks for a name and a level before anything else', async () => {
    localStorage.removeItem('go.profile');
    await open();
    expect(screen.queryByTestId('hub-play-bot')).toBeNull();
    expect(screen.queryByTestId('hub-close')).toBeNull();
    expect(screen.getByTestId('welcome-level-beginner').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByTestId('welcome-done').props.accessibilityState).toMatchObject({ disabled: true });
    // A name alone is not enough: the player has to choose a level.
    await fireEvent.changeText(screen.getByTestId('welcome-name'), 'Jane Doe');
    expect(screen.getByTestId('welcome-done').props.accessibilityState).toMatchObject({ disabled: true });
    await tap('welcome-level-casual');
    await tap('welcome-done');
    expect(within(screen.getByTestId('hub-profile')).getByText('Jane Doe')).toBeTruthy();
    await tap('hub-profile');
    expect(text('hub-level-value')).toBe('I play now and then');
  });

  it('the welcome offers an animal as avatar, shown on the card instead of the colour, which moves beside the name', async () => {
    localStorage.removeItem('go.profile');
    await open();
    expect(screen.getByTestId('welcome-avatar-none').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.changeText(screen.getByTestId('welcome-name'), 'Jane Doe');
    await tap('welcome-level-casual');
    await tap('welcome-avatar-5');
    expect(screen.getByTestId('welcome-avatar-5').props.accessibilityState).toMatchObject({ checked: true });
    await tap('welcome-done');
    expect(JSON.parse(localStorage.getItem('go.profile')!).avatar).toBe('🦊');
    expect(within(screen.getByTestId('hub-profile')).getByText('🦊')).toBeTruthy();
    await start('bot');
    expect(text('avatar-black')).toBe('🦊');
    expect(text('avatar-white')).toBe('🤖');
    // While playing, a small stone beside each name says whose colour is whose.
    expect(screen.getByTestId('mark-black')).toBeTruthy();
    expect(screen.getByTestId('mark-white')).toBeTruthy();
    expect(screen.queryByTestId('swatch-black')).toBeNull();
  });

  it('without an avatar the card shows the stone in its disc instead of beside the name, as both players have face to face until the count', async () => {
    await open();
    await start('human');
    for (const c of ['black', 'white']) {
      expect(screen.getByTestId(`disc-stone-${c}`)).toBeTruthy();
      expect(screen.queryByTestId(`avatar-${c}`)).toBeNull();
      expect(screen.queryByTestId(`mark-${c}`)).toBeNull();
    }
    expect(screen.queryByTestId('profile-black')).toBeNull();
    expect(screen.queryByTestId('profile-white')).toBeNull();
    // From the count on, each end's score table names both players, so the cards make room for it.
    await point('E5');
    await passAnyway('pass-top');
    await passAnyway('pass');
    expect(screen.getByTestId('player-black')).toBeTruthy();
    await tap('accept');
    expect(screen.queryByTestId('player-black')).toBeNull();
    expect(screen.getByTestId('score-breakdown-top')).toBeTruthy();
    // Each end's table says which row is the player sitting there.
    const hidden = { includeHiddenElements: true };
    expect(within(screen.getByTestId('breakdown-black', hidden)).getByText('you', hidden)).toBeTruthy();
    expect(within(screen.getByTestId('breakdown-white', hidden)).queryByText('you', hidden)).toBeNull();
    expect(within(screen.getByTestId('breakdown-white-top', hidden)).getByText('you', hidden)).toBeTruthy();
    await tap('count-skip');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    expect(screen.queryByTestId('player-white')).toBeNull();
  });

  it('the avatar can be changed or cleared in the profile', async () => {
    await open();
    await tap('hub-profile');
    expect(screen.getByTestId('hub-avatar-none').props.accessibilityState).toMatchObject({ checked: true });
    await tap('hub-avatar-0');
    expect(JSON.parse(localStorage.getItem('go.profile')!).avatar).toBe('🐶');
    await tap('hub-back');
    await start('bot');
    expect(text('avatar-black')).toBe('🐶');
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');
    await tap('hub-avatar-none');
    expect(JSON.parse(localStorage.getItem('go.profile')!).avatar).toBeUndefined();
  });

  it('Go ranks can be shown at any level, and stay hidden until turned on', async () => {
    localStorage.setItem('go.profile', JSON.stringify({ name: 'Jane Doe', level: 'basics', rating: -350, games: 0 }));
    await open();
    await start('bot');
    expect(screen.getByTestId('player-black').props.accessibilityLabel).not.toMatch(/25k/);
    await tap('guide');
    await tap('show-ranks');
    await tap('sheet-close');
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/25k/);
  });

  it('the name can be changed, but not emptied; the rating can start again from another level', async () => {
    await open();
    await start('bot');
    await tap('guide');
    await tap('show-ranks');
    expect(screen.queryByTestId('level-value')).toBeNull();
    await tap('sheet-close');
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/^Jane Doe · 20k/);
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');
    expect(text('hub-level-value')).toBe('Beginner · 20k');
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), '');
    await tap('hub-profile-done');
    expect(within(screen.getByTestId('hub-profile')).getByText('Jane Doe')).toBeTruthy();
    // The back arrow keeps a new name too.
    await tap('hub-profile');
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), 'Jane Roe');
    await tap('hub-back');
    expect(within(screen.getByTestId('hub-profile')).getByText('Jane Roe')).toBeTruthy();

    await tap('hub-profile');
    await tap('hub-restart-rating');
    expect(screen.getByTestId('hub-restart-yes').props.accessibilityState).toMatchObject({ disabled: true });
    await tap('hub-restart-cancel');
    expect(text('hub-level-value')).toBe('Beginner · 20k');
    await tap('hub-restart-rating');
    await tap('hub-restart-level-club');
    await tap('hub-restart-yes');
    expect(text('hub-level-value')).toMatch(/^.+ · 5k$/);
    expect(JSON.parse(localStorage.getItem('go.profile')!)).toMatchObject({ level: 'club', games: 0 });
  });

  it('starting the rating again sticks while a finished game against the bot is still on screen', async () => {
    await open();
    await start('bot');
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await screen.findByTestId('result-card');
    expect(JSON.parse(localStorage.getItem('go.profile')!)).toMatchObject({ games: 1 });
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');
    await tap('hub-restart-rating');
    await tap('hub-restart-level-club');
    await tap('hub-restart-yes');
    expect(JSON.parse(localStorage.getItem('go.profile')!)).toMatchObject({ level: 'club', games: 0 });
  });

  it('the result shows whether a rated game moved the rank', async () => {
    localStorage.setItem('go.showRanks', 'on');
    await open();
    await start('bot');
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await screen.findByTestId('result-card');
    // A new player starts mid-rank, so one loss moves the rating but not the rank.
    expect(screen.getByText('Your rank: 20k')).toBeTruthy();
    expect(await screen.findByTestId('rank-same')).toBeTruthy();
    expect(screen.getByLabelText('Your rank: 20k, unchanged')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('go.profile')!).rating).toBeLessThan(150);
  });

  it('a game played with the Coach on moves no rating: setup warns, the result says so, and the list marks it', async () => {
    localStorage.setItem('go.teaching', 'on');
    await open();
    await tap('hub-play-bot');
    expect(screen.getByText('The Coach is on, so this game won’t count for your rating.')).toBeTruthy();
    await tap('hub-start');
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await screen.findByTestId('result-card');
    expect(screen.getByText('Played with the Coach: not rated')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('go.profile')!)).toMatchObject({ rating: 150, games: 0 });
    const [kept] = JSON.parse(localStorage.getItem('go.finishedGames')!);
    expect(kept.game.meta).toMatchObject({ mode: 'bot', coached: true });
    expect(kept.game.meta.rating).toBeUndefined();
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');
    expect(within(screen.getByTestId('hub-history')).getByText(/^9×9 · .* · With the Coach$/)).toBeTruthy();
  });

  it('a game against the bot with a move taken back moves no rating: the result says so, and the list marks it', async () => {
    await open();
    await start('bot');
    await point('E5');
    await botReplies();
    await tap('undo');
    await tap('undo');
    await point('D4');
    await botReplies();
    // Once taken back, the game is unrated: later undos don't ask.
    await tap('undo');
    expect(label('D4')).toBe('D4, empty');
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await screen.findByTestId('result-card');
    expect(screen.getByText('Moves taken back: not rated')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('go.profile')!)).toMatchObject({ rating: 150, games: 0 });
    const [kept] = JSON.parse(localStorage.getItem('go.finishedGames')!);
    expect(kept.game.meta).toMatchObject({ mode: 'bot', tookBack: true });
    expect(kept.game.meta.rating).toBeUndefined();
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');
    expect(within(screen.getByTestId('hub-history')).getByText(/^9×9 · .* · Moves taken back$/)).toBeTruthy();
  });

  it('a move taken back stays on the game after the app restarts, and face to face undo asks nothing', async () => {
    const first = await open();
    await start('bot');
    await point('E5');
    await botReplies();
    await point('F6');
    expect(label('F6')).toBe('F6, black stone');
    await botReplies();
    await tap('undo');
    await tap('undo');
    expect(label('F6')).toBe('F6, empty');
    await first.unmount();
    await open();
    await tap('hub-resume');
    await tap('undo');
    expect(label('E5')).toBe('E5, empty');

    await tap('options');
    await tap('options-hub');
    await startOver('human');
    await point('E5');
    await tap('undo');
    expect(label('E5')).toBe('E5, empty');
  });

  it('finished games are kept on the phone and listed in the profile, newest first', async () => {
    await open();
    expect(screen.queryByTestId('hub-family')).toBeNull();
    await start('bot');
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await screen.findByTestId('result-card');
    await tap('options');
    await tap('options-hub');
    await start('human');
    await passAnyway('pass');
    await passAnyway('pass-top');
    await tap('accept');
    if (screen.queryByTestId('count-skip')) await tap('count-skip');
    await screen.findByTestId('result-card');
    // Face to face has no menu button once the game is over; New game starts another, which has one.
    await tap('rematch');
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');

    const history = within(screen.getByTestId('hub-history'));
    expect(history.getAllByText(/^(Bot|Face to face)$/).map((t) => t.props.children)).toEqual(['Face to face', 'Bot']);
    expect(history.getByText('White won by 7½ points')).toBeTruthy();
    expect(history.getByText('You lost by resignation')).toBeTruthy();
    // Losing to the bot moved the rating down; the face-to-face game left it alone.
    expect(history.getAllByText(/^9×9 · .*−\d+$/)).toHaveLength(1);
    // A phone without a family server has nothing to wait for.
    expect(screen.queryAllByLabelText('Not kept with the family yet')).toHaveLength(0);
    const kept = JSON.parse(localStorage.getItem('go.finishedGames')!);
    expect(kept.map((k: { game: { meta: { mode: string } } }) => k.game.meta.mode)).toEqual(['face_to_face', 'bot']);
    // Played signed out: the games are this phone's until a player claims them.
    expect(kept.some((k: { game: { meta: object } }) => 'player' in k.game.meta)).toBe(false);
    expect(kept[1].game).toMatchObject({
      format: 1,
      core: { result: { winner: 'white', reason: 'resign', margin: null } },
      meta: { you: 'black', rating: { before: 150, opponent: 300 } },
    });
  });

  it('a kept game opens from the profile at its result, whatever kind it is, and Done comes back to the list', async () => {
    await open();
    await start('bot');
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await screen.findByTestId('result-card');
    await tap('options');
    await tap('options-hub');
    await start('human');
    await passAnyway('pass');
    await passAnyway('pass-top');
    await tap('accept');
    if (screen.queryByTestId('count-skip')) await tap('count-skip');
    await screen.findByTestId('result-card');
    await tap('rematch');
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');
    const kept = JSON.parse(localStorage.getItem('go.finishedGames')!) as { game: { id: string } }[];

    await tap(`history-${kept[1].game.id}`);
    expect(screen.queryByTestId('hub-history')).toBeNull();
    await screen.findByTestId('result-card');
    expect(screen.getByText('Bot wins')).toBeTruthy();
    expect(screen.queryByTestId('pass')).toBeNull();
    await tap('rematch');
    expect(within(screen.getByTestId('hub-history')).getByText('You lost by resignation')).toBeTruthy();

    await tap(`history-${kept[0].game.id}`);
    await screen.findByTestId('result-card');
    if (screen.queryByTestId('count-skip')) await tap('count-skip');
    expect(screen.getByText('White wins!')).toBeTruthy();
    expect(screen.getByText('by 7½ points')).toBeTruthy();
  });

  it('the language follows at once, board labels included', async () => {
    await open();
    await start('human');
    await point('G7');
    await openFacingSettings();
    await tap('opt-lang-fi');
    await closeFacingSettings();
    expect(label('G7')).toBe('G7, musta kivi');
  });

  it('the language follows the phone until one is chosen, and can follow it again', async () => {
    await open();
    await tap('hub-options');
    const followsPhone = () => screen.getByTestId('opt-lang-phone').props.accessibilityState.checked;
    expect(followsPhone()).toBe(true);
    await tap('opt-lang-fi');
    expect(followsPhone()).toBe(false);
    expect(localStorage.getItem('go.language')).toBe('fi');
    await tap('opt-lang-phone');
    expect(followsPhone()).toBe(true);
    expect(language()).toBe(phoneLanguage());
    expect(localStorage.getItem('go.language')).toBeNull();
  });

  it('feedback asks a player who is not signed in to the family to sign in first', async () => {
    await open();
    await start('bot');
    await tap('options');
    await tap('feedback');
    expect(await screen.findByText('Sign in and enter the family code to send feedback.')).toBeTruthy();
    expect(screen.queryByTestId('feedback-text')).toBeNull();
    await tap('feedback-sign-in');
    expect(await screen.findByTestId('hub-player-name')).toBeTruthy();
  });

  it('shows the copyright, licence and version in the main menu and the welcome', async () => {
    await open();
    expect(text('hub-about')).toMatch(/^© 2026 JPH · AGPLv3 · [0-9]+\.[0-9]+/);
    localStorage.removeItem('go.profile');
    await open();
    expect(text('welcome-about')).toMatch(/AGPLv3/);
  });

  it('shows the cover picture when the copyright line is tapped, and closes it', async () => {
    await open();
    await tap('hub-about');
    expect(screen.getByTestId('hub-about-cover')).toBeTruthy();
    expect(text('hub-about-cover-about')).toMatch(/AGPLv3/);
    await tap('hub-about-cover-close');
    expect(screen.queryByTestId('hub-about-cover')).toBeNull();
  });

  it('lists the licences of KataGo and the other works it ships, from the cover', async () => {
    await open();
    await tap('hub-about');
    await tap('hub-about-cover-about');
    expect(screen.getByText(/GNU Affero General Public License, version 3/)).toBeTruthy();
    expect(screen.queryByText(/KataGo Neural Network License/)).toBeNull();
    expect(screen.queryByText(/ported from its source/)).toBeNull();
    await fireEvent.press(screen.getByText('KataGo'));
    expect(await screen.findByText(/KataGo Neural Network License/)).toBeTruthy();
    expect(screen.getByText(/ported from its source/)).toBeTruthy();
    expect(screen.getByText(/^ONNX Runtime/)).toBeTruthy();
    expect(screen.getByText(/^react-native \d/)).toBeTruthy();
  });
});
