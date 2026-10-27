import { FinishedGame, readFinished } from '../../go/finished';
import { readable } from '../../go/__tests__/records';
import { ApiError, Player, RecordCursor, RecordRow } from '../../net/api';
import type { HistoryCursor, KeptGame } from '../../ui/prefs';
import { HistoryBackend, HistoryStore, HistorySync } from '../historySync';

const A = 'aaaaaaaa-0000-4000-8000-000000000000';
const B = 'bbbbbbbb-0000-4000-8000-000000000000';
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const golden = readFinished(readable().find(([f]) => f === 'v1/bot-9-scored.json')![1]) as FinishedGame;
/** A game owned by `player` (none: played signed out), ended `minutes` into the day. */
function game(player: string | undefined, minutes: number): FinishedGame {
  const time = new Date(Date.UTC(2026, 9, 23, 0, minutes)).toISOString();
  const meta = { ...golden.meta, player };
  if (!player) delete meta.player;
  return { ...golden, id: uuid(), startedAt: time, endedAt: time, meta };
}

/** The account's records on the server, and its answers. */
class Server implements HistoryBackend {
  member = true;
  offline = false;
  refuse = new Set<string>();
  records: RecordRow[] = [];
  asked: (RecordCursor | null)[] = [];
  levels: [string, string][] = [];
  /** Holds every call until released, for a sign-out in the middle of one. */
  hold: Promise<void> | null = null;
  private clock = Date.UTC(2026, 9, 23, 12);

  private async reach() {
    if (this.hold) await this.hold;
    if (this.offline) throw new ApiError('network', 'Network request failed');
  }
  async me(): Promise<Player | null> {
    await this.reach();
    if (!this.member) return null;
    return {
      id: A,
      name: 'John Doe',
      avatar: null,
      rating: 650 + this.records.length,
      rated_games: this.records.length,
      level: 'casual',
      rating_since: null,
    };
  }
  async recordFinishedGame(g: FinishedGame) {
    await this.reach();
    if (this.refuse.has(g.id)) throw new ApiError('bad_game', 'bad_game');
    this.add(g);
  }
  async myRecords(after: RecordCursor | null, limit = 100) {
    await this.reach();
    this.asked.push(after);
    const from = after ? [after.uploadedAt, after.id] : null;
    return this.records
      .filter((r) => !from || r.uploaded_at > from[0] || (r.uploaded_at === from[0] && r.id > from[1]))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
  async setMyLevel(level: string, since: string) {
    await this.reach();
    this.levels.push([level, since]);
  }
  /** A record arrives, from this phone or another of the account's. */
  add(g: FinishedGame) {
    this.records = this.records.filter((r) => r.id !== g.id);
    this.clock += 1000;
    this.records.push({ id: g.id, record: structuredClone(g), uploaded_at: new Date(this.clock).toISOString() });
  }
}

class Store implements HistoryStore {
  kept: KeptGame[] = [];
  holderId: string | null = null;
  cursors = new Map<string, HistoryCursor>();
  load() {
    return structuredClone(this.kept);
  }
  save(kept: readonly KeptGame[]) {
    this.kept = structuredClone([...kept]);
  }
  holder() {
    return this.holderId;
  }
  setHolder(account: string) {
    this.holderId = account;
  }
  cursor(account: string) {
    return this.cursors.get(account) ?? null;
  }
  setCursor(account: string, c: HistoryCursor | null) {
    if (c) this.cursors.set(account, c);
    else this.cursors.delete(account);
  }
}

let server: Server;
let store: Store;
let errors: unknown[];
const sync = (account = A) => new HistorySync(server, account, store, '1.2.3', (e) => errors.push(e));

beforeEach(() => {
  server = new Server();
  store = new Store();
  errors = [];
});

describe('history sync', () => {
  it('claims the games played signed out and sends the account’s, oldest first', async () => {
    const signedOut = game(undefined, 2);
    const mine = game(A, 1);
    store.kept = [
      { game: signedOut, uploaded: false },
      { game: mine, uploaded: false },
    ];
    const h = sync();
    const states: boolean[] = [];
    h.subscribe((s) => states.push(s.synced));
    await h.sync();
    expect(server.records.map((r) => r.id)).toEqual([mine.id, signedOut.id]);
    expect(server.records[1].record).toMatchObject({ meta: { player: A } });
    expect(store.kept.every((k) => k.uploaded)).toBe(true);
    expect(store.holderId).toBe(A);
    expect(h.state()).toMatchObject({ synced: true, me: { rated_games: 2 } });
    expect(h.state().kept).toEqual(store.kept);
    expect(states[states.length - 1]).toBe(true);
    expect(states.slice(0, -1).every((s) => !s)).toBe(true);
  });

  it('leaves the games unsent while offline, and sends them on the next run', async () => {
    store.kept = [{ game: game(A, 1), uploaded: false }];
    server.offline = true;
    const h = sync();
    await h.sync();
    expect(store.kept[0].uploaded).toBe(false);
    expect(h.state().synced).toBe(false);
    expect(errors).toEqual([]);
    server.offline = false;
    await h.sync();
    expect(store.kept[0].uploaded).toBe(true);
    expect(server.records).toHaveLength(1);
  });

  it('marks a record the server refuses and sends the rest', async () => {
    const bad = game(A, 1);
    const good = game(A, 2);
    store.kept = [
      { game: bad, uploaded: false },
      { game: good, uploaded: false },
    ];
    server.refuse.add(bad.id);
    await sync().sync();
    expect(store.kept.find((k) => k.game.id === bad.id)).toMatchObject({ uploaded: false, refused: true });
    expect(server.records.map((r) => r.id)).toEqual([good.id]);
    expect(errors).toHaveLength(1);
  });

  it('does nothing outside the family', async () => {
    server.member = false;
    const h = sync();
    // Kept after the sync started up: what it shows is what the phone has now.
    store.kept = [{ game: game(undefined, 1), uploaded: false }];
    await h.sync();
    expect(h.state().kept).toEqual(store.kept);
    expect(store.kept[0].game).not.toHaveProperty('meta.player');
    expect(server.records).toEqual([]);
    expect(h.state()).toMatchObject({ me: null, synced: true });
  });

  it('reads every game from the account’s other phones, then only what is new', async () => {
    for (let i = 0; i < 250; i++) server.add(game(A, i));
    const h = sync();
    await h.sync();
    expect(store.kept).toHaveLength(250);
    expect(server.asked.map((a) => a?.id ?? null)).toEqual([null, server.records[99].id, server.records[199].id]);
    server.add(game(A, 300));
    server.asked = [];
    await h.sync();
    expect(store.kept).toHaveLength(251);
    expect(server.asked).toHaveLength(1);
    // From a little before the last record read, for one a slow write kept just before it.
    expect(Date.parse(server.asked[0]!.uploadedAt)).toBe(Date.parse(server.records[249].uploaded_at) - 60_000);
  });

  it('when another account signs in, the first one’s sent games leave and its unsent ones wait', async () => {
    const sentByB = game(B, 1);
    const unsentByB = game(B, 2);
    store.holderId = B;
    store.cursors.set(B, { uploadedAt: '2026-10-23T00:00:00.000Z', id: uuid() });
    store.cursors.set(A, { uploadedAt: '2030-01-01T00:00:00.000Z', id: uuid() });
    store.kept = [
      { game: sentByB, uploaded: true },
      { game: unsentByB, uploaded: false },
    ];
    server.add(game(A, 3));
    await sync().sync();
    expect(store.kept.map((k) => k.game.id)).toContain(unsentByB.id);
    expect(store.kept.map((k) => k.game.id)).not.toContain(sentByB.id);
    expect(server.records.map((r) => r.id)).not.toContain(unsentByB.id);
    // A's history is read from the start again, since the phone held B's meanwhile.
    expect(server.asked[0]).toBeNull();
    expect(store.kept).toHaveLength(2);
  });

  it('keeps a game finished while a run sends another', async () => {
    store.kept = [{ game: game(A, 1), uploaded: false }];
    let release!: () => void;
    server.hold = new Promise((r) => (release = r));
    const h = sync();
    const run = h.sync();
    const later = game(A, 2);
    store.kept = [{ game: later, uploaded: false }, ...store.kept];
    server.hold = null;
    release();
    await run;
    expect(store.kept.map((k) => k.game.id)).toContain(later.id);
    await h.sync();
    expect(store.kept.every((k) => k.uploaded)).toBe(true);
  });

  it('a run asked for during another follows it', async () => {
    const h = sync();
    const first = h.sync();
    store.kept = [{ game: game(A, 1), uploaded: false }];
    void h.sync();
    await first;
    expect(server.records).toHaveLength(1);
  });

  it('after the account signs out, nothing it asked for is stored or shown', async () => {
    store.kept = [{ game: game(A, 1), uploaded: false }];
    let release!: () => void;
    server.hold = new Promise((r) => (release = r));
    const h = sync();
    const seen = jest.fn();
    h.subscribe(seen);
    const run = h.sync();
    h.stop();
    server.hold = null;
    release();
    await run;
    expect(seen).not.toHaveBeenCalled();
    expect(store.kept[0].uploaded).toBe(false);
    expect(store.holderId).toBeNull();
  });

  it('sends the level the player chose, and says when the server could not be told', async () => {
    const h = sync();
    server.offline = true;
    expect(await h.reportLevel('club', '2026-10-23T09:00:00.000Z')).toBe(false);
    server.offline = false;
    expect(await h.reportLevel('club', '2026-10-23T09:00:00.000Z')).toBe(true);
    expect(server.levels).toEqual([['club', '2026-10-23T09:00:00.000Z']]);
  });
});
