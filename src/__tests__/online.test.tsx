import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { FinishedGame, readFinished } from '../go/finished';
import { pointFromName } from '../go/rules';
import { readable } from '../go/__tests__/records';
import { MatchSync } from '../net/match';
import { GameEvent, RULES_VERSION } from '../online/log';
import { setLanguage } from '../ui/i18n';
import { FakeOnline, G1, G2, ME, PEER } from './fakeOnline';

/** Online games on the game screen, against a family server in memory and a second phone. */

let mockServer = new FakeOnline();
const golden = readFinished(readable().find(([f]) => f === 'v1/bot-9-scored.json')![1]) as FinishedGame;
jest.mock('../net/client', () => ({
  get api() {
    return mockServer;
  },
}));

// The bot's network: one that always favours C3.
jest.mock('../../modules/go-net', () => ({
  BOT_NET: 'test-net',
  netAvailable: true,
  preloadNet: jest.fn(),
  evaluateNet: jest.fn(async (_name: string, size: number) => {
    const policy = new Array(size * size).fill(-20);
    policy[2 * size + (size - 3)] = 5;
    return { policy, pass: [-20], value: [0, 0, -20], score: [0], ownership: new Array(size * size).fill(0) };
  }),
}));

let mockTestLab = false;
jest.mock('../../modules/test-lab', () => ({
  get onTestLab() {
    return mockTestLab;
  },
}));

let clock = 0;
const realNow = Date.now.bind(Date);
jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clock);
async function tap(id: string) {
  clock += 1000;
  await fireEvent.press(await screen.findByTestId(id));
}
/** Passes, tapping again when the app asks because much of the board is still open. */
async function passAnyway(id: string) {
  await tap(id);
  if (screen.queryAllByText(/^There’s still open space to claim/).length) await tap(id);
}
const point = async (name: string) => {
  clock += 1000;
  await fireEvent(screen.getByTestId(`pt-${name}`), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
};
const label = (name: string) => screen.getByTestId(`pt-${name}`).props.accessibilityLabel as string;
const text = (id: string) => [screen.getByTestId(id).props.children].flat().join('');
/** The message beside the board, or '' when the cards say all there is (whose turn it is). */
const status = () => (screen.queryByTestId('status') ? text('status') : '');
/** Whether the card shows it is this player's turn. */
const toPlay = (c: 'black' | 'white') => /, to play$/.test(screen.getByTestId(`player-${c}`).props.accessibilityLabel as string);

async function open() {
  const view = await render(<App />);
  await fireEvent(screen.getByTestId('board-area'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 700 } } });
  return view;
}

/** Joins the family from the menu's online view. */
async function join() {
  await tap('hub-play-online');
  await fireEvent.changeText(await screen.findByTestId('family-code'), 'family');
  await tap('register');
  await screen.findByText('Playing as John Doe');
}

/** Creates a 9×9 game as Black, which the other phone joins; returns that phone. */
async function startGame(): Promise<MatchSync> {
  await join();
  await tap('create-game');
  expect(status()).toBe('Waiting for someone to join');
  await act(async () => mockServer.join(PEER, G1));
  const peer = await mockServer.peer(G1);
  await waitFor(() => expect(toPlay('black') && status() === '').toBe(true));
  return peer;
}

/** The other phone acts once it has caught up. */
async function peerDoes(peer: MatchSync, event: GameEvent) {
  await act(async () => {
    await peer.refresh();
    const r = await peer.act(event);
    if (!r.ok) throw new Error(JSON.stringify(r.problem));
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('go.confirmMoves', 'off');
  localStorage.setItem('go.profile', JSON.stringify({ name: 'John Doe', level: 'beginner', rating: 150, games: 0 }));
  setLanguage('en');
  mockServer = new FakeOnline();
  mockTestLab = false;
});

describe('online', () => {
  it('your avatar opens Profile and the other player’s their card; refused edits stay there and the game keeps receiving moves', async () => {
    await open();
    const peer = await startGame();
    await tap('profile-white');
    const card = within(screen.getByTestId('member-sheet'));
    expect(card.getByText('Jane Doe')).toBeTruthy();
    expect(card.getByText('🦉')).toBeTruthy();
    expect(card.getByText('Level')).toBeTruthy();
    expect(card.getByText('Rated games')).toBeTruthy();
    expect(screen.queryByTestId('hub-player-name')).toBeNull();
    await tap('sheet-backdrop');
    await point('E5');
    await tap('profile-black');
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), 'Jane Doe');
    await tap('hub-back');
    expect(await screen.findByTestId('hub-name-error')).toBeTruthy();
    await peerDoes(peer, { kind: 'play', color: 'white', point: pointFromName(9, 'C3') });
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), 'Johnny Doe');
    await tap('hub-profile-done');
    await waitFor(() => expect(label('C3')).toBe('C3, white stone'));
    expect(label('E5')).toBe('E5, black stone');
    expect(screen.queryByTestId('hub-player-name')).toBeNull();
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/^Johnny Doe/);
  });

  it('joins the family once the code matches', async () => {
    await open();
    await tap('hub-play-online');
    expect(await screen.findByTestId('hub-online')).toBeTruthy();
    expect(screen.getByText('You join as John Doe.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('family-code'), 'wrong');
    await tap('register');
    expect(await screen.findByText('That family code did not match. Please try again.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('family-code'), 'family');
    await tap('register');
    expect(await screen.findByText('Playing as John Doe')).toBeTruthy();
    expect(screen.getByTestId('create-game')).toBeTruthy();
  });

  it('offers only the family games this app can play', async () => {
    await open();
    mockServer.create(PEER, 9, 'white', 0, RULES_VERSION + 1);
    mockServer.create(PEER, 9, 'white');
    await join();
    expect(await screen.findByTestId(`join-${G2}`)).toBeTruthy();
    expect(screen.queryByTestId(`join-${G1}`)).toBeNull();
  });

  it('says how to start another game when too many are waiting, without reporting an error', async () => {
    await open();
    for (let i = 0; i < 10; i++) mockServer.create(ME, 9, 'black');
    await join();
    await tap('create-game');
    expect(
      await screen.findByText('You have too many games waiting for someone to join. Open one and cancel it, then try again.'),
    ).toBeTruthy();
    expect(mockServer.games.size).toBe(10);
    expect(mockServer.reports).toEqual([]);
  });

  it('shows who was seen, asks one to play, and starts when they join', async () => {
    await open();
    mockServer.people[1].last_seen_at = new Date().toISOString();
    await join();
    expect(await screen.findByText('Online now')).toBeTruthy();
    await tap(`person-${PEER}`);
    expect(screen.getAllByText('Ask Jane Doe to play').length).toBeGreaterThan(0);
    await tap('create-game');
    expect(mockServer.games.get(G1)?.invited).toBe(PEER);
    expect(status()).toBe('Waiting for someone to join');
    await act(async () => mockServer.join(PEER, G1));
    await waitFor(() => expect(toPlay('black') && status() === '').toBe(true));
  });

  it('shows a game addressed to you as an ask, and keeps one addressed to someone else out of the list', async () => {
    await open();
    mockServer.create(PEER, 13, 'black');
    mockServer.games.set(G1, { ...mockServer.games.get(G1)!, invited: ME });
    mockServer.create(PEER, 9, 'black');
    mockServer.games.set(G2, { ...mockServer.games.get(G2)!, invited: 'cccccccc-0000-4000-8000-000000000003' });
    await join();
    expect(await screen.findByTestId('invitations')).toBeTruthy();
    expect(screen.getByText(/13×13 · You play White/)).toBeTruthy();
    expect(screen.queryByTestId(`join-${G2}`)).toBeNull();
    await tap(`join-${G1}`);
    await waitFor(() => expect(mockServer.games.get(G1)?.status).toBe('playing'));
  });

  it('plays on the game screen: player cards, your stone at the bottom, no undo', async () => {
    await open();
    const peer = await startGame();
    expect(screen.getByTestId('player-white').props.accessibilityLabel).toMatch(/^Jane Doe/);
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/^John Doe.*, to play$/);
    // Each card shows the avatar its player picked on their own phone, or their stone without one.
    expect([screen.getByTestId('avatar-white').props.children].flat().join('')).toBe('🦉');
    expect(screen.getByTestId('disc-stone-black')).toBeTruthy();
    expect(screen.queryByTestId('mark-black')).toBeNull();
    expect(screen.getByTestId('mark-white')).toBeTruthy();
    expect(screen.queryByTestId('undo')).toBeNull();
    expect(screen.getByTestId('guide')).toBeTruthy();
    expect(screen.getByTestId('online-connection')).toBeTruthy();
    expect(screen.getByTestId('options')).toBeTruthy();
    await point('E5');
    await waitFor(() => expect(label('E5')).toBe('E5, black stone'));
    expect(toPlay('white')).toBe(true);
    expect(status()).toBe('');
    await peerDoes(peer, { kind: 'play', color: 'white', point: pointFromName(9, 'C3') });
    await waitFor(() => expect(label('C3')).toBe('C3, white stone'));
    expect(screen.getByTestId('player-black').props.accessibilityLabel).toMatch(/, to play$/);
  });

  it('shows beside the other player whether they are here, kept fresh during the game, or that this phone is offline', async () => {
    await open();
    const peer = await startGame();
    const status = () => screen.getByTestId('online-connection').props.accessibilityLabel;
    mockServer.people[1].last_seen_at = new Date(Date.now() - 10 * 60_000).toISOString();
    await point('E5');
    await peerDoes(peer, { kind: 'play', color: 'white', point: pointFromName(9, 'C3') });
    await waitFor(() => expect(status()).toBe('Seen 10 min ago'));

    mockServer.people[1].last_seen_at = new Date().toISOString();
    await point('D4');
    await waitFor(() => expect(status()).toBe('Online now'));

    mockServer.offline = true;
    await act(async () => mockServer.ping(G1));
    await waitFor(() => expect(status()).toBe('Offline. Trying again…'));
  });

  it('Continue returns to the online game after the app restarts, until a game on this phone takes its place', async () => {
    const first = await open();
    await startGame();
    await point('E5');
    await first.unmount();
    const second = await open();
    expect(await screen.findByText('9×9 · 🦉 Jane Doe · Move 1')).toBeTruthy();
    await tap('hub-resume');
    expect(label('E5')).toBe('E5, black stone');

    await tap('options');
    await tap('options-hub');
    await tap('hub-play-human');
    await tap('hub-start');
    await point('D4');
    await second.unmount();
    await open();
    expect(await screen.findByText('9×9 · Face to face · Move 1')).toBeTruthy();
  });

  it('names the other player in the game summary, and keeps the Coach off, greyed out', async () => {
    localStorage.setItem('go.teaching', 'on');
    await open();
    await startGame();
    await point('E5');
    await tap('options');
    expect(screen.getByText('9×9 · 🦉 Jane Doe · Move 1')).toBeTruthy();
    await tap('options-hub');
    expect(await screen.findByText('9×9 · 🦉 Jane Doe · Move 1')).toBeTruthy();
    await tap('hub-resume');

    await tap('guide');
    const coach = screen.getByTestId('quick-teaching');
    expect(coach.props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    expect(screen.getByText('Off in online games, where you play without its help.')).toBeTruthy();
    await tap('quick-teaching');
    expect(localStorage.getItem('go.teaching')).toBe('on');
  });

  it('finishes with the same review and count as offline, then offers a rematch', async () => {
    await open();
    const peer = await startGame();
    await point('E5');
    await peerDoes(peer, { kind: 'play', color: 'white', point: pointFromName(9, 'C3') });
    await waitFor(() => expect(toPlay('black') && status() === '').toBe(true));
    await passAnyway('pass');
    await peerDoes(peer, { kind: 'pass', color: 'white' });
    await waitFor(() => expect(status()).toMatch(/^No stones marked/));
    await tap('accept');
    await waitFor(() => expect(status()).toBe('You already accepted. Waiting for the other player.'));
    expect(screen.getByTestId('accept').props.accessibilityState).toMatchObject({ disabled: true });
    await peerDoes(peer, { kind: 'accept', color: 'white' });
    await tap('count-skip');
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    expect(screen.getByTestId('breakdown-black')).toBeTruthy();
    expect(text('result-subtitle')).toMatch(/^by .* points$/);
    expect(screen.getByTestId('rematch').props.accessibilityLabel ?? '').toMatch(/^Rematch/);

    await tap('rematch');
    await waitFor(() => expect(mockServer.games.size).toBe(2));
    await waitFor(() => expect(status()).toBe('Waiting for someone to join'));

    // The finished game is in the profile's list, once, and no longer in the lobby's.
    await tap('options');
    await tap('new-game');
    expect(screen.queryByTestId(`join-${G1}`)).toBeNull();
    await tap('hub-back');
    await tap('options-hub');
    await tap('hub-profile');
    const rows = within(screen.getByTestId('hub-history')).getAllByTestId(/^history-/);
    expect(rows).toHaveLength(1);
    // Opened again it shows its result at once, without counting again, and the cards open nothing.
    await tap(rows[0].props.testID);
    expect(await screen.findByTestId('result-card')).toBeTruthy();
    expect(screen.queryByTestId('count-skip')).toBeNull();
    expect(screen.queryByTestId('profile-black')).toBeNull();
    expect(screen.queryByTestId('profile-white')).toBeNull();
    await tap('rematch');
    expect(within(screen.getByTestId('hub-history')).getAllByTestId(/^history-/)).toHaveLength(1);
    await waitFor(() => expect(mockServer.finished.size).toBe(1));
  });

  it('a tap on the other player’s turn sends nothing, and a tap while scoring sends the mark to the other phone', async () => {
    await open();
    const peer = await startGame();
    await point('E5');
    const sent = () => mockServer.events.get(G1)!.length;
    const before = sent();
    await point('D4');
    await act(() => new Promise((r) => setTimeout(r, 50)));
    // Not even tried: a move the other phone's turn would refuse shows a note.
    expect(screen.queryByTestId('board-note')).toBeNull();
    expect(label('D4')).toBe('D4, empty');
    expect(sent()).toBe(before);
    await peerDoes(peer, { kind: 'play', color: 'white', point: pointFromName(9, 'C3') });
    await waitFor(() => expect(toPlay('black') && status() === '').toBe(true));
    await passAnyway('pass');
    await peerDoes(peer, { kind: 'pass', color: 'white' });
    await waitFor(() => expect(status()).toMatch(/^No stones marked/));
    await point('C3');
    await waitFor(() => expect(label('C3')).toMatch(/^C3, white stone, marked dead/));
    expect(mockServer.events.get(G1)!.at(-1)!.event).toMatchObject({ kind: 'mark', color: 'black', point: pointFromName(9, 'C3') });
  });

  it('resigns from Options, after asking', async () => {
    await open();
    await startGame();
    await tap('options');
    await tap('resign');
    expect(screen.getByText('Resign? You will lose this game.')).toBeTruthy();
    await tap('resign-yes');
    await waitFor(() => expect(text('result-subtitle')).toBe('You resigned'));
    expect(text('result-title')).toBe('Jane Doe wins');
  });

  it('the result shows the player’s rank and how the game moved it, with ranks on', async () => {
    localStorage.setItem('go.showRanks', 'on');
    await open();
    await startGame();
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await waitFor(() => expect(text('result-subtitle')).toBe('You resigned'));
    // A new player's first loss against an even rating takes them a rank down.
    expect(await screen.findByText('Your rank: 21k')).toBeTruthy();
    expect(screen.getByTestId('rank-down')).toBeTruthy();
    expect(screen.getByLabelText('Your rank: 21k, down from 20k')).toBeTruthy();
  });

  it('a game that ended before this phone kept ratings says it was not rated', async () => {
    await open();
    await startGame();
    localStorage.setItem('go.ratedGames', JSON.stringify({ since: '2099-01-01T00:00:00.000Z', ids: [] }));
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await waitFor(() => expect(text('result-subtitle')).toBe('You resigned'));
    expect(await screen.findByText('Older game: not rated')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('go.profile')!)).toMatchObject({ rating: 150, games: 0 });
  });

  it('keeps the finished game with the server times of its first event and the one that ended it', async () => {
    await open();
    const peer = await startGame();
    clock += 60_000;
    await point('E5');
    await peerDoes(peer, { kind: 'play', color: 'white', point: pointFromName(9, 'C3') });
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await waitFor(() => expect(text('result-subtitle')).toBe('You resigned'));
    const events = mockServer.events.get(G1)!;
    const [{ game }] = JSON.parse(localStorage.getItem('go.finishedGames')!);
    expect(events[0].created_at).not.toBe(mockServer.games.get(G1)!.created_at);
    expect([game.startedAt, game.endedAt]).toEqual([events[0].created_at, events.at(-1)!.created_at]);
    expect(game.startedAt < game.endedAt).toBe(true);
    expect(game.meta).toMatchObject({ player: ME, opponent: PEER, you: 'black' });
  });

  it('sends feedback from Options with the online game attached', async () => {
    await open();
    await startGame();
    await tap('options');
    await tap('feedback');
    await fireEvent.changeText(await screen.findByTestId('feedback-text'), 'The board is great');
    await tap('feedback-send');
    expect(await screen.findByText('Thank you! Your message was sent.')).toBeTruthy();
    const report = mockServer.reports.find((r) => r.message === 'The board is great');
    expect(report?.details).toMatchObject({ mode: 'online', game_id: G1 });
  });

  it('keeps one game at a time: opening an online game asks before it gives up the game on this phone', async () => {
    await open();
    await tap('hub-play-human');
    await tap('hub-start');
    await point('D4');
    await tap('options');
    await tap('options-hub');
    await join();
    await tap('create-game');
    expect(screen.getByTestId('lobby-replace-confirm')).toBeTruthy();
    expect(mockServer.games.size).toBe(0);
    await tap('lobby-keep');
    expect(label('D4')).toBe('D4, black stone');

    await tap('options');
    await tap('options-hub');
    await tap('hub-play-online');
    await tap('create-game');
    await tap('lobby-discard');
    await waitFor(() => expect(status()).toBe('Waiting for someone to join'));

    // The main menu continues the online game, the only one there is.
    await tap('options');
    await tap('options-hub');
    expect(await screen.findByText('9×9')).toBeTruthy();
    await tap('hub-resume');
    expect(status()).toBe('Waiting for someone to join');

    // New game opens Play online, and its back arrow returns to the game's menu.
    await tap('options');
    await tap('new-game');
    expect(await screen.findByTestId('hub-online')).toBeTruthy();
    await tap('hub-back');
    expect(await screen.findByTestId('options-sheet')).toBeTruthy();
    expect(screen.queryByTestId('lobby')).toBeNull();

    // A game on this phone doesn't ask first: the online game still waits in Play online.
    await tap('options-hub');
    await tap('hub-play-human');
    await tap('hub-start');
    expect(screen.queryByTestId('hub-replace-confirm')).toBeNull();
    expect(label('D4')).toBe('D4, empty');
  });
});

describe('identity and finished games', () => {
  it('the welcome keeps the profile on this device and needs no account or connection', async () => {
    localStorage.removeItem('go.profile');
    mockServer.identity = null;
    mockServer.offline = true;
    await open();
    await tap('welcome-new');
    await fireEvent.changeText(screen.getByTestId('welcome-name'), 'John Doe');
    await tap('welcome-level-casual');
    // Sign-in is offered after the questions, never among them, and can be passed by.
    expect(screen.queryByTestId('sign-in-email')).toBeNull();
    await tap('welcome-next');
    expect(screen.getByTestId('sign-in-email')).toBeTruthy();
    expect(screen.queryByTestId('welcome-family-code')).toBeNull();
    await tap('welcome-done');
    expect(await screen.findByTestId('hub-play-bot')).toBeTruthy();
    expect(mockServer.joined).toBe(false);
    await tap('hub-profile');
    expect(screen.getByTestId('sign-in-email')).toBeTruthy();
    expect(screen.queryByTestId('hub-family-code')).toBeNull();
  });

  it('the welcome signs in and joins the family, and the family sees the animal picked there', async () => {
    localStorage.removeItem('go.profile');
    mockServer.identity = null;
    await open();
    await tap('welcome-new');
    await fireEvent.changeText(screen.getByTestId('welcome-name'), 'John Doe');
    await tap('welcome-level-casual');
    await tap('welcome-avatar-5');
    await tap('welcome-next');
    await signIn();
    await fireEvent.changeText(await screen.findByTestId('welcome-family-code'), 'wrong');
    await tap('welcome-done');
    expect(await screen.findByTestId('welcome-error')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('welcome-family-code'), 'family');
    await tap('welcome-done');
    expect(await screen.findByTestId('hub-play-bot')).toBeTruthy();
    expect(mockServer.joined).toBe(true);
    await waitFor(() => expect(mockServer.people[0].avatar).toBe('🦊'));
    await tap('hub-play-online');
    expect(await screen.findByText('Playing as John Doe')).toBeTruthy();
  });

  it('a returning player signs in and gets the family’s profile back without answering the questions', async () => {
    localStorage.removeItem('go.profile');
    mockServer.identity = null;
    mockServer.joined = true;
    Object.assign(mockServer.people[0], {
      name: 'Cloud name',
      avatar: '🐢',
      level: 'intermediate',
      rating_since: '2026-10-01T00:00:00.000+00:00',
      rating: 900,
      rated_games: 12,
    });
    await open();
    await tap('welcome-returning');
    expect(screen.queryByTestId('welcome-name')).toBeNull();
    // Back goes to the first choice, as Android's back does.
    await tap('welcome-back');
    await tap('welcome-returning');
    await signIn();
    expect(await screen.findByTestId('hub-play-bot')).toBeTruthy();
    expect(within(screen.getByTestId('hub-profile')).getByText('Cloud name')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('go.profile') ?? '{}')).toMatchObject({
      name: 'Cloud name',
      avatar: '🐢',
      level: 'intermediate',
      rating: 900,
      games: 12,
    });
  });

  it('the keyboard’s own key sends the code and signs in, so the buttons may stay under the keyboard', async () => {
    localStorage.removeItem('go.profile');
    mockServer.identity = null;
    mockServer.joined = true;
    await open();
    await tap('welcome-returning');
    // An address that isn't one yet sends nothing.
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'john.doe@');
    await fireEvent(screen.getByTestId('sign-in-email'), 'submitEditing');
    expect(screen.queryByTestId('sign-in-code')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'john.doe@example.com');
    await fireEvent(screen.getByTestId('sign-in-email'), 'submitEditing');
    await fireEvent.changeText(await screen.findByTestId('sign-in-code'), '123456');
    await fireEvent(screen.getByTestId('sign-in-code'), 'submitEditing');
    expect(await screen.findByTestId('hub-play-bot')).toBeTruthy();
  });

  it('a returning player whose email has no family profile answers the questions, then joins with the code', async () => {
    localStorage.removeItem('go.profile');
    mockServer.identity = null;
    await open();
    await tap('welcome-returning');
    await signIn();
    await tap('welcome-continue');
    await fireEvent.changeText(screen.getByTestId('welcome-name'), 'John Doe');
    await tap('welcome-level-casual');
    await tap('welcome-next');
    expect(screen.getByTestId('signed-in')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('welcome-family-code'), 'family');
    await tap('welcome-done');
    expect(await screen.findByTestId('hub-play-bot')).toBeTruthy();
    expect(mockServer.joined).toBe(true);
  });

  it('joining keeps the animal picked on this phone, and the phone takes the family’s when it has one', async () => {
    localStorage.setItem('go.profile', JSON.stringify({ name: 'John Doe', avatar: '🦊', level: 'beginner', rating: 150, games: 0 }));
    await open();
    await join();
    await waitFor(() => expect(mockServer.people[0].avatar).toBe('🦊'));
    await tap('hub-back');
    await tap('hub-profile');
    expect(screen.getByTestId('hub-player-name').props.value).toBe('John Doe');
    expect(JSON.parse(localStorage.getItem('go.profile') ?? '{}').avatar).toBe('🦊');
  });

  it('a signed-in player joins from the profile; a wrong code or a name in use keeps them out', async () => {
    localStorage.setItem('go.profile', JSON.stringify({ name: 'jane doe', level: 'beginner', rating: 150, games: 0 }));
    await open();
    await tap('hub-profile');
    await fireEvent.changeText(screen.getByTestId('hub-family-code'), 'wrong');
    await tap('hub-join');
    expect(await screen.findByText('That family code did not match. Please try again.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('hub-family-code'), 'family');
    await tap('hub-join');
    expect(await screen.findByText('Someone already has that name. Please choose another.')).toBeTruthy();
    expect(mockServer.joined).toBe(false);
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), 'John Doe');
    await tap('hub-profile-done');
    await tap('hub-profile');
    await fireEvent.changeText(screen.getByTestId('hub-family-code'), 'family');
    await tap('hub-join');
    expect(await screen.findByText('You can play online with others on their own devices.')).toBeTruthy();
    expect(mockServer.joined).toBe(true);
  });

  it('a finished game stays on this device, and goes to the account on joining the family', async () => {
    await open();
    await start();
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await screen.findByTestId('result-card');
    // Played signed in, so the record names its owner even without a family.
    const [{ game }] = JSON.parse(localStorage.getItem('go.finishedGames')!);
    expect(game.meta).toMatchObject({ mode: 'bot', player: ME });
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');
    expect(within(screen.getByTestId('hub-history')).getByText('You lost by resignation')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('hub-family-code'), 'family');
    await tap('hub-join');
    await screen.findByText('You can play online with others on their own devices.');
    const rated = JSON.parse(localStorage.getItem('go.profile')!);
    await waitFor(() => expect(mockServer.finished.size).toBe(1));
    expect(within(screen.getByTestId('hub-history')).getByText('You lost by resignation')).toBeTruthy();
    // The server works the rating out from the game it now has: the same one the phone showed.
    await waitFor(() => expect(mockServer.people[0]).toMatchObject({ level: rated.level, rating: rated.rating, rated_games: 1 }));
    expect(JSON.parse(localStorage.getItem('go.profile')!)).toMatchObject({ rating: rated.rating, games: 1 });
  });

  it('lists the games from the account’s other phones, and marks one this phone has not sent yet', async () => {
    mockServer.joined = true;
    const there = { ...golden, id: '11111111-0000-4000-8000-000000000001', meta: { ...golden.meta, player: ME } } as FinishedGame;
    await mockServer.recordFinishedGame(there);
    await open();
    await tap('hub-profile');
    expect(await screen.findByTestId(`history-${there.id}`)).toBeTruthy();
    expect(text('hub-history-hint')).toBe('Saved on this device and in your account.');
    expect(screen.queryByTestId(`unsent-${there.id}`)).toBeNull();
    await tap('hub-profile-done');
    mockServer.offline = true;
    await start();
    await tap('options');
    await tap('resign');
    await tap('resign-yes');
    await screen.findByTestId('result-card');
    await tap('options');
    await tap('options-hub');
    await tap('hub-profile');
    const [{ game }] = JSON.parse(localStorage.getItem('go.finishedGames')!);
    expect(screen.getByTestId(`unsent-${game.id}`)).toBeTruthy();
    expect(screen.getAllByTestId(/^unsent-/)).toHaveLength(1);
  });

  it('a name taken in the family is refused when renaming, and the old name stays', async () => {
    await open();
    await join();
    await tap('hub-back');
    await tap('hub-profile');
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), 'Jane Doe');
    await tap('hub-profile-done');
    expect(await screen.findByTestId('hub-name-error')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('hub-player-name'), 'Johnny Doe');
    await tap('hub-profile-done');
    await waitFor(() => expect(mockServer.people[0].name).toBe('Johnny Doe'));
  });
});

/** Signs in with an emailed code from whatever page shows the email field. */
async function signIn() {
  await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'john.doe@example.com');
  await tap('send-code');
  await fireEvent.changeText(screen.getByTestId('sign-in-code'), '123456');
  await tap('verify-code');
}

/** Starts a game against the bot from the main menu. */
async function start() {
  await tap('hub-play-bot');
  await tap('hub-start');
}

describe('email sign-in', () => {
  it('sends no code from Google’s test devices, whose crawler types made-up addresses', async () => {
    mockTestLab = true;
    mockServer.identity = null;
    const sendCode = jest.spyOn(mockServer, 'sendCode');
    await open();
    await tap('hub-play-online');
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'crawler@example.com');
    await tap('send-code');
    expect(await screen.findByTestId('sign-in-error')).toBeTruthy();
    expect(sendCode).not.toHaveBeenCalled();
  });

  it('signs in with a code to the family’s profile, and keeps it on the phone after signing out', async () => {
    mockServer.identity = null;
    mockServer.joined = true;
    Object.assign(mockServer.people[0], {
      name: 'Cloud name',
      avatar: '🐢',
      level: 'intermediate',
      rating_since: '2026-10-01T00:00:00.000+00:00',
      rating: 900,
      rated_games: 12,
    });
    await open();
    await tap('hub-play-online');
    expect(screen.queryByTestId('family-code')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'john.doe@example.com');
    await tap('send-code');
    await fireEvent.changeText(screen.getByTestId('sign-in-code'), '000000');
    await tap('verify-code');
    expect(await screen.findByTestId('sign-in-error')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('sign-in-code'), '123456');
    await tap('verify-code');
    expect(await screen.findByText('Playing as Cloud name')).toBeTruthy();
    expect(screen.queryByTestId('family-code')).toBeNull();
    await tap('hub-back');
    await tap('hub-profile');
    expect(screen.getByTestId('hub-player-name').props.value).toBe('Cloud name');
    expect(JSON.parse(localStorage.getItem('go.profile') ?? '{}')).toMatchObject({
      avatar: '🐢',
      level: 'intermediate',
      rating: 900,
      games: 12,
    });
    await tap('sign-out');
    expect(screen.queryByTestId('sign-out')).toBeNull();
    expect(screen.getByTestId('hub-player-name').props.value).toBe('Cloud name');
  });
});
