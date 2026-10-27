import type { FinishedGame } from '../go/finished';
import { Level, MAX_RATING, MIN_RATING, startingRating } from '../go/rating';
import { Color, newGame } from '../go/rules';
import { Account, ApiError, EventRow, GameRow, NewReport, Player, RecordCursor, RecordRow } from '../net/api';
import { MatchSync } from '../net/match';
import { RULES_VERSION, SealedEvent, Summary } from '../online/log';
import type { OnlineBackend } from '../screens/onlineMatch';

// Ids are UUIDs, as on the server: the records of finished games name them, and the phone reads only those.
export const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
export const PEER = 'bbbbbbbb-0000-4000-8000-000000000002';
/** The id of the `n`th game created. */
export const gameId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
export const G1 = gameId(1);
export const G2 = gameId(2);

/**
 * The family server in memory, for screen tests: this phone and one other player, games and
 * their events with the summary columns, and Realtime hints delivered at once.
 */
export class FakeOnline implements OnlineBackend {
  joined = false;
  identity: Account | null = { id: ME, email: 'john.doe@example.com' };
  private accountWatchers = new Set<(account: Account | null) => void>();
  forAccount(_owner: string) {
    return this;
  }
  async account() {
    return this.identity;
  }
  watchAccount(on: (account: Account | null) => void) {
    this.accountWatchers.add(on);
    return () => {
      this.accountWatchers.delete(on);
    };
  }
  async sendCode(_email: string) {
    this.reach();
  }
  async verifyCode(email: string, code: string) {
    this.reach();
    if (code !== '123456') throw new ApiError('unknown', 'Token has expired or is invalid');
    this.identity = { id: ME, email };
    this.accountWatchers.forEach((on) => on(this.identity));
  }
  async signOut() {
    this.identity = null;
    this.accountWatchers.forEach((on) => on(null));
  }
  people: Player[] = [
    { id: ME, name: 'John Doe', rating: null, rated_games: 0, avatar: null, level: null, rating_since: null },
    { id: PEER, name: 'Jane Doe', rating: null, rated_games: 0, avatar: '🦉', level: null, rating_since: null },
  ];
  games = new Map<string, GameRow>();
  events = new Map<string, EventRow[]>();
  reports: NewReport[] = [];
  /** The family's finished-game records, by id, in the order the server kept them. */
  finished = new Map<string, RecordRow & { player: string; record: FinishedGame }>();
  private keptAt = Date.UTC(2026, 9, 23, 12);
  /** The server can't be reached: joining, loading and uploading fail as without a connection. */
  offline = false;
  private lobbyWatchers = new Set<() => void>();
  private gameWatchers = new Map<string, Set<() => void>>();

  async me() {
    this.reach();
    return this.identity && this.joined ? { ...this.player(this.identity.id) } : null;
  }
  async register(name: string, code: string) {
    this.reach();
    if (code !== 'family') throw new ApiError('wrong_family_code', 'wrong_family_code');
    this.claim(name);
    this.player(ME).name = name;
    this.joined = true;
  }
  async rename(name: string) {
    this.claim(name);
    this.player(ME).name = name;
  }
  async recordFinishedGame(g: FinishedGame) {
    this.reach();
    if (!this.joined) throw new ApiError('not_a_player', 'not_a_player');
    const by = this.identity!.id;
    const online = g.meta.onlineGame;
    const again = [...this.finished.values()].find((f) => f.player === by && online && f.record.meta.onlineGame === online);
    const id = again?.id ?? g.id;
    this.finished.delete(id);
    this.keptAt += 1000;
    this.finished.set(id, { id, player: by, record: structuredClone({ ...g, id }), uploaded_at: new Date(this.keptAt).toISOString() });
    this.refreshRating(by);
  }
  async myRecords(after: RecordCursor | null, limit = 100) {
    this.reach();
    if (!this.joined) throw new ApiError('not_a_player', 'not_a_player');
    const by = this.identity!.id;
    return [...this.finished.values()]
      .filter((r) => r.player === by)
      .filter((r) => !after || r.uploaded_at > after.uploadedAt || (r.uploaded_at === after.uploadedAt && r.id > after.id))
      .slice(0, limit)
      .map(({ id, record, uploaded_at }) => ({ id, record: structuredClone(record), uploaded_at }));
  }
  async setMyLevel(level: Level, since: string) {
    this.reach();
    if (!this.joined) throw new ApiError('not_a_player', 'not_a_player');
    const me = this.player(this.identity!.id);
    if (me.rating_since && Date.parse(me.rating_since) >= Date.parse(since)) return;
    Object.assign(me, { level, rating_since: since });
    this.refreshRating(me.id);
  }
  /** As the server does: the level's starting rating moved by the player's rated games since it was chosen. */
  private refreshRating(id: string) {
    const p = this.player(id);
    if (!p.level || !p.rating_since) return;
    const since = Date.parse(p.rating_since);
    const rated = [...this.finished.values()].filter(
      (r) => r.player === id && r.record.meta.rating && Date.parse(r.record.endedAt) >= since,
    );
    const sum = rated.reduce((s, r) => s + r.record.meta.rating!.after - r.record.meta.rating!.before, startingRating(p.level));
    Object.assign(p, { rating: Math.min(MAX_RATING, Math.max(MIN_RATING, sum)), rated_games: rated.length });
  }
  async setMyAvatar(avatar: string | null) {
    Object.assign(this.player(ME), { avatar });
  }
  async players(ids: readonly string[]) {
    return this.people.filter((p) => ids.includes(p.id)).map((p) => ({ ...p }));
  }
  async seenPlayers(me: string) {
    return this.people.filter((p) => p.id !== me && p.last_seen_at).map((p) => ({ ...p }));
  }
  async touchPresence() {
    this.reach();
    this.player(ME).last_seen_at = new Date().toISOString();
    return new Date().toISOString();
  }
  async askToPlay(player: string, size: number, color: Color, handicap = 0) {
    const id = this.create(ME, size, color, handicap);
    this.games.set(id, { ...this.games.get(id)!, invited: player });
    this.notify(id);
    return id;
  }
  async listGames(me: string) {
    return [...this.games.values()].filter((g) => g.status === 'open' || g.black === me || g.white === me).map((g) => ({ ...g }));
  }
  async createGame(size: number, color: Color, handicap = 0) {
    return this.create(ME, size, color, handicap);
  }
  async joinGame(id: string) {
    this.join(ME, id);
  }
  async cancelGame(id: string) {
    this.games.delete(id);
    this.notify(id);
  }
  async gameRow(id: string) {
    this.reach();
    const row = this.games.get(id);
    if (!row) throw new ApiError('unknown', `Game ${id} not found`);
    return { ...row };
  }
  async eventsAfter(id: string, after: number, upTo: number) {
    return (this.events.get(id) ?? []).filter((e) => e.n > after && e.n <= upTo).map((e) => ({ ...e, event: structuredClone(e.event) }));
  }
  async addEvent(id: string, n: number, event: SealedEvent, s: Summary) {
    const row = this.games.get(id)!;
    if (n !== row.move_count + 1) throw new ApiError('out_of_sync', 'out_of_sync');
    this.events
      .get(id)!
      .push({ game_id: id, n, player: row[event.color]!, event: structuredClone(event), created_at: new Date(Date.now()).toISOString() });
    const reset = ['play', 'pass', 'mark', 'resume'].includes(event.kind);
    const accepted = (c: Color) => !reset && (row[`${c}_accepted`] || (event.kind === 'accept' && event.color === c));
    this.games.set(id, {
      ...row,
      move_count: n,
      status: s.status,
      to_play: s.toPlay,
      result: s.result,
      head_hash: event.hash,
      black_accepted: accepted('black'),
      white_accepted: accepted('white'),
      updated_at: new Date().toISOString(),
    });
    this.notify(id);
  }
  async disputeGame(id: string, n: number, reason: string) {
    this.games.set(id, { ...this.games.get(id)!, status: 'disputed', dispute: { n, reason, by: ME } });
  }
  watchGame(id: string, on: { ready: () => void }) {
    const set = this.gameWatchers.get(id) ?? new Set();
    this.gameWatchers.set(id, set);
    set.add(on.ready);
    return () => void set.delete(on.ready);
  }
  watchLobby(onChange: () => void) {
    this.lobbyWatchers.add(onChange);
    return () => void this.lobbyWatchers.delete(onChange);
  }
  async sendReports(reports: NewReport[]) {
    this.reports.push(...reports);
  }

  /** A game created by `by`, who sits in `color`; a newer app may create one under later rules. */
  create(by: string, size: number, color: Color, handicap = 0, rulesVersion = RULES_VERSION): string {
    if ([...this.games.values()].filter((g) => g.created_by === by && g.status === 'open').length >= 10) {
      throw new ApiError('too_many_open_games', 'too_many_open_games');
    }
    const id = gameId(this.games.size + 1);
    const now = new Date().toISOString();
    this.games.set(id, {
      id,
      size,
      komi: newGame(size, undefined, handicap).komi,
      black: color === 'black' ? by : null,
      white: color === 'white' ? by : null,
      created_by: by,
      status: 'open',
      to_play: handicap > 1 ? 'white' : 'black',
      move_count: 0,
      result: null,
      rules_version: rulesVersion,
      handicap,
      head_hash: null,
      black_accepted: false,
      white_accepted: false,
      dispute: null,
      created_at: now,
      updated_at: now,
    });
    this.events.set(id, []);
    this.notify(id);
    return id;
  }

  /** `by` takes the free seat. */
  join(by: string, id: string) {
    const row = this.games.get(id)!;
    if (row.status !== 'open') throw new ApiError('game_not_open', 'game_not_open');
    if (row.invited && row.invited !== by) throw new ApiError('not_invited', 'not_invited');
    this.games.set(id, { ...row, black: row.black ?? by, white: row.white ?? by, status: 'playing' });
    this.notify(id);
  }

  /** The other player's phone in game `id`, verifying everything as this one does. */
  async peer(id: string): Promise<MatchSync> {
    const sync = new MatchSync(this, id, PEER, (p) => {
      throw new Error(`Peer found an integrity problem at ${p.n}: ${p.reason}`);
    });
    await sync.refresh();
    return sync;
  }

  private reach() {
    if (this.offline) throw new ApiError('network', 'Network request failed');
  }

  /** Names are unique in the family, whatever their case. */
  private claim(name: string) {
    if (this.people.some((p) => p.id !== ME && p.name.toLowerCase() === name.trim().toLowerCase())) {
      throw new ApiError('name_taken', 'name_taken');
    }
  }

  private player(id: string) {
    return this.people.find((p) => p.id === id)!;
  }

  /** A realtime message about the game, which has the phone read it again. */
  ping(id: string) {
    this.notify(id);
  }
  private notify(id: string) {
    for (const w of this.gameWatchers.get(id) ?? []) w();
    for (const w of this.lobbyWatchers) w();
  }
}
