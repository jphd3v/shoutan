import { ApiError, GameRow, Player } from '../api';
import { Lobby, LobbyBackend } from '../lobby';

const ME = 'me';

function game(id: string, fields: Partial<GameRow> = {}): GameRow {
  return {
    id,
    size: 9,
    komi: 7.5,
    black: 'other',
    white: null,
    created_by: 'other',
    status: 'open',
    to_play: 'black',
    move_count: 0,
    result: null,
    rules_version: 1,
    handicap: 0,
    head_hash: null,
    black_accepted: false,
    white_accepted: false,
    dispute: null,
    created_at: '',
    updated_at: '',
    ...fields,
  };
}

/** A backend whose calls can be held open, to interleave refreshes and taps. */
class FakeBackend implements LobbyBackend {
  me_: Player | null = { id: ME, name: 'John Doe', rating: null, rated_games: 0, avatar: null, level: null, rating_since: null };
  games: GameRow[] = [game('g1')];
  players_: Player[] = [
    { id: ME, name: 'John Doe', rating: null, rated_games: 0, avatar: null, level: null, rating_since: null },
    { id: 'other', name: 'Jane Doe', rating: 1250, rated_games: 12, avatar: '🦉', level: null, rating_since: null },
  ];
  offline = false;
  calls: string[] = [];
  private gates: (() => void)[] = [];
  hold = false;

  private async gate(name: string) {
    this.calls.push(name);
    if (this.hold) await new Promise<void>((r) => this.gates.push(r));
    if (this.offline) throw new TypeError('Network request failed');
  }
  release() {
    this.hold = false;
    for (const g of this.gates.splice(0)) g();
  }
  async me() {
    await this.gate('me');
    return this.me_;
  }
  async listGames() {
    await this.gate('listGames');
    return this.games.map((g) => ({ ...g }));
  }
  async players(ids: readonly string[]) {
    await this.gate('players');
    return this.players_.filter((p) => ids.includes(p.id));
  }
  async seenPlayers(me: string) {
    await this.gate('seenPlayers');
    return this.players_.filter((p) => p.id !== me && p.last_seen_at);
  }
  touches = 0;
  serverAhead = 0;
  async touchPresence() {
    await this.gate('touchPresence');
    this.touches += 1;
    return new Date(Date.now() + this.serverAhead).toISOString();
  }
  async askToPlay(player: string, size: number, color: string, handicap: number) {
    await this.gate('askToPlay');
    this.created.push(['ask', player, size, color, handicap]);
    this.games.push(game('asked', { black: ME, created_by: ME, invited: player }));
    return 'asked';
  }
  async register(name: string, code: string) {
    await this.gate('register');
    if (code !== 'family') throw new ApiError('wrong_family_code', 'wrong_family_code');
    if (name === 'Jane Doe') throw new ApiError('name_taken', 'name_taken');
    this.me_ = { id: ME, name, rating: null, rated_games: 0, avatar: null, level: null, rating_since: null };
  }
  async rename(name: string) {
    await this.gate('rename');
    this.me_ = { ...this.me_!, name };
  }
  avatars: (string | null)[] = [];
  async setMyAvatar(avatar: string | null) {
    await this.gate('setMyAvatar');
    this.avatars.push(avatar);
    this.me_ = { ...this.me_!, avatar };
  }
  created: unknown[][] = [];
  async createGame(...args: unknown[]) {
    await this.gate('createGame');
    this.created.push(args);
    this.games.push(game('new', { black: ME, created_by: ME }));
    return 'new';
  }
  async joinGame(id: string) {
    await this.gate('joinGame');
    const g = this.games.find((x) => x.id === id)!;
    if (g.status !== 'open') throw new ApiError('game_not_open', 'game_not_open');
    g.white = ME;
    g.status = 'playing';
  }
  async cancelGame(id: string) {
    await this.gate('cancelGame');
    this.games = this.games.filter((g) => g.id !== id);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Lobby', () => {
  it('loads the player, games and names', async () => {
    const lobby = new Lobby(new FakeBackend());
    expect(lobby.state().me).toBeUndefined();
    await lobby.refresh();
    expect(lobby.state()).toMatchObject({ me: { name: 'John Doe' }, online: true, busy: false, problem: null });
    expect(lobby.state().games.map((g) => g.id)).toEqual(['g1']);
    expect(lobby.state().nameOf('other')).toBe('Jane Doe');
  });

  it('keeps an error on screen through background refreshes until the next action', async () => {
    const api = new FakeBackend();
    api.me_ = null;
    const lobby = new Lobby(api);
    await lobby.refresh();
    expect(await lobby.register('John Doe', 'guess')).toBe(false);
    expect(lobby.state().problem).toBe('wrongFamilyCode');
    await lobby.refresh();
    await lobby.refresh();
    expect(lobby.state().problem).toBe('wrongFamilyCode');
    expect(await lobby.register('John Doe', 'family')).toBe(true);
    expect(lobby.state()).toMatchObject({ problem: null, me: { name: 'John Doe' } });
  });

  it('says when someone in the family already has the name', async () => {
    const api = new FakeBackend();
    api.me_ = null;
    const lobby = new Lobby(api);
    await lobby.refresh();
    expect(await lobby.register('Jane Doe', 'family')).toBe(false);
    expect(lobby.state()).toMatchObject({ problem: 'nameTaken', me: null });
  });

  it('a tap during a background refresh is not dropped, and refreshes never mark the lobby busy', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.refresh();
    api.hold = true;
    const refreshing = lobby.refresh();
    expect(lobby.state().busy).toBe(false);
    const creating = lobby.create(9, 'black');
    await flush();
    expect(lobby.state().busy).toBe(true);
    api.release();
    await refreshing;
    expect(await creating).toBe('new');
    expect(api.calls).toContain('createGame');
    expect(lobby.state().busy).toBe(false);
    expect(lobby.state().games.map((g) => g.id)).toContain('new');
  });

  it('knows the family’s ratings', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.refresh();
    expect(lobby.state().ratingOf('other')).toBe(1250);
    expect(lobby.state().ratingOf(ME)).toBeNull();
  });

  it('knows the family’s avatars, and reports this phone’s only when it changed', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.refresh();
    expect(lobby.state().avatarOf('other')).toBe('🦉');
    expect(lobby.state().avatarOf(ME)).toBeNull();
    await lobby.reportAvatar(null);
    await lobby.reportAvatar('🦊');
    await lobby.reportAvatar('🦊');
    expect(api.avatars).toEqual(['🦊']);
    expect(lobby.state().avatarOf(ME)).toBe('🦊');
    await lobby.reportAvatar(null);
    expect(api.avatars).toEqual(['🦊', null]);
    expect(lobby.state().busy).toBe(false);
  });

  it('creates an even game unless a handicap is chosen', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.create(9, 'black');
    await lobby.create(13, 'white', 3);
    expect(api.created).toEqual([
      [9, 'black', 0],
      [13, 'white', 3],
    ]);
  });

  it('a refresh that started before an action cannot overwrite what the action showed', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.refresh();
    api.hold = true;
    const stale = lobby.refresh(); // reads the list before the game is created
    await flush();
    api.hold = false;
    await lobby.create(9, 'black');
    api.release();
    await stale;
    expect(lobby.state().games.map((g) => g.id)).toContain('new');
  });

  it('only one action at a time; a second tap while busy does nothing', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.refresh();
    api.hold = true;
    const first = lobby.create(9, 'black');
    await flush();
    expect(await lobby.create(13, 'white')).toBeNull();
    api.release();
    expect(await first).toBe('new');
    expect(api.calls.filter((c) => c === 'createGame')).toHaveLength(1);
  });

  it('opening your own game needs no call; a game someone else took is reported', async () => {
    const api = new FakeBackend();
    api.games = [
      game('mine', { black: ME, created_by: ME, status: 'playing', white: 'other' }),
      game('taken', { status: 'playing', white: 'x' }),
    ];
    const lobby = new Lobby(api);
    await lobby.refresh();
    expect(await lobby.open('mine')).toBe('mine');
    expect(api.calls).not.toContain('joinGame');
    expect(await lobby.open('taken')).toBeNull();
    expect(lobby.state().problem).toBe('gameTaken');
  });

  it('joins an open game and returns it', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.refresh();
    expect(await lobby.open('g1')).toBe('g1');
    expect(lobby.state().games[0]).toMatchObject({ white: ME, status: 'playing' });
  });

  it('goes offline without losing what it showed, and comes back', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.refresh();
    api.offline = true;
    await lobby.refresh();
    expect(lobby.state()).toMatchObject({ online: false, problem: null, me: { name: 'John Doe' } });
    expect(lobby.state().games).toHaveLength(1);
    expect(await lobby.rename('Johnny Doe')).toBe(false);
    expect(lobby.state().problem).toBe('offline');
    api.offline = false;
    await lobby.refresh();
    expect(lobby.state().online).toBe(true);
  });

  it('cancels an open game of yours and reports unexpected failures', async () => {
    const api = new FakeBackend();
    api.games = [game('mine', { black: ME, created_by: ME })];
    const errors: unknown[] = [];
    const lobby = new Lobby(api, (e) => errors.push(e));
    await lobby.refresh();
    expect(await lobby.cancel('mine')).toBe(true);
    expect(lobby.state().games).toEqual([]);
    api.cancelGame = async () => {
      throw new ApiError('unknown', 'boom');
    };
    expect(await lobby.cancel('mine')).toBe(false);
    expect(lobby.state().problem).toBe('failed');
    expect(errors).toHaveLength(1);
  });

  it('says plainly when the server has online play switched off', async () => {
    const api = new FakeBackend();
    const errors: unknown[] = [];
    api.me = async () => {
      throw new ApiError('unavailable', 'Anonymous sign-ins are disabled');
    };
    api.register = async () => {
      throw new ApiError('unavailable', 'Anonymous sign-ins are disabled');
    };
    const lobby = new Lobby(api, (e) => errors.push(e));
    await lobby.refresh();
    expect(lobby.state()).toMatchObject({ online: false, unavailable: true, problem: null });
    expect(await lobby.register('John Doe', 'family')).toBe(false);
    expect(lobby.state().problem).toBe('unavailable');
    // Reported once per refresh and action, so the owner hears about it.
    expect(errors).toHaveLength(2);
  });

  it('tells subscribers about every change', async () => {
    const lobby = new Lobby(new FakeBackend());
    const seen: boolean[] = [];
    const stop = lobby.subscribe((s) => seen.push(s.busy));
    await lobby.refresh();
    await lobby.create(9, 'black');
    stop();
    await lobby.refresh();
    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(false);
    const count = seen.length;
    await lobby.refresh();
    expect(seen).toHaveLength(count);
  });

  it('lists the others seen with Play online open, the latest first, and who is online now', async () => {
    const api = new FakeBackend();
    const now = Date.now();
    api.players_.push(
      {
        id: 'a',
        name: 'Richard Roe',
        rating: null,
        rated_games: 0,
        avatar: null,
        level: null,
        rating_since: null,
        last_seen_at: new Date(now - 600_000).toISOString(),
      },
      {
        id: 'b',
        name: 'Jane Roe',
        rating: null,
        rated_games: 0,
        avatar: null,
        level: null,
        rating_since: null,
        last_seen_at: new Date(now - 5_000).toISOString(),
      },
    );
    const lobby = new Lobby(api);
    await lobby.refresh();
    const s = lobby.state();
    expect(s.people.map((p) => p.id)).toEqual(['b', 'a']);
    expect(s.isOnline('b')).toBe(true);
    expect(s.isOnline('a')).toBe(false);
  });

  it('judges online by the server’s clock when the phone’s is wrong', async () => {
    const api = new FakeBackend();
    api.serverAhead = -3_600_000;
    api.players_.push({
      id: 'b',
      name: 'Jane Roe',
      rating: null,
      rated_games: 0,
      avatar: null,
      level: null,
      rating_since: null,
      last_seen_at: new Date(Date.now() - 3_600_000 - 5_000).toISOString(),
    });
    const lobby = new Lobby(api);
    await lobby.refresh();
    expect(lobby.state().isOnline('b')).toBe(false);
    await lobby.present();
    expect(lobby.state().isOnline('b')).toBe(true);
  });

  it('says it is present at most every 20 seconds, and only once the family knows it', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.present();
    expect(api.touches).toBe(0);
    await lobby.refresh();
    await lobby.present();
    await lobby.present();
    expect(api.touches).toBe(1);
  });

  it('asks a member to play, which creates a game addressed to them', async () => {
    const api = new FakeBackend();
    const lobby = new Lobby(api);
    await lobby.refresh();
    expect(await lobby.ask('other', 13, 'white', 2)).toBe('asked');
    expect(api.created).toEqual([['ask', 'other', 13, 'white', 2]]);
    expect(lobby.state().games.find((g) => g.id === 'asked')?.invited).toBe('other');
  });
});
