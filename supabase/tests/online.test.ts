/**
 * Runs the app's API layer against the local Supabase stack (`npm run test:db`
 * resets it first). Each GoApi is a separate permanent email account.
 */
import { emailSession } from '../../scripts/lib/test-identity';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { FinishedGame, readFinished } from '../../src/go/finished';
import { broken, extended, newer, readable } from '../../src/go/__tests__/records';
import { pointFromName } from '../../src/go/rules';
import { ApiError, EventRow, GoApi } from '../../src/net/api';
import { IntegrityProblem, MatchSync } from '../../src/net/match';
import { GameEvent, OnlineGame, RULES_VERSION, seal, SealedEvent, startOnline, summary, Summary } from '../../src/online/log';

const url = process.env.SUPABASE_URL!;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const FAMILY = 'local-family';
/** `public` for the local migrations, or `go` installed by scripts/schema-sql.mjs like the hosted project. */
const SCHEMA = process.env.SUPABASE_SCHEMA ?? 'public';

const clients: SupabaseClient[] = [];
function client(key = publishableKey): SupabaseClient {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.push(c);
  return c;
}
const authAdmin = client(secretKey);
async function signedClient() {
  const db = client();
  await emailSession(authAdmin, db);
  return db;
}
const phone = async () => new GoApi(await signedClient(), SCHEMA);
/** A phone plus direct access to its client, for checking what the API never exposes. */
async function rawPhone() {
  const db = await signedClient();
  return { api: new GoApi(db, SCHEMA), db: db.schema(SCHEMA) };
}
const admin = client(secretKey).schema(SCHEMA);

// Names are unique and the database keeps players between runs, so every name carries its own mark.
const RUN = Date.now().toString(36).slice(-5);
let registered = 0;
const named = (name: string) => `${name} ${RUN}${++registered}`;

async function player(name: string) {
  const api = await phone();
  const unique = named(name);
  await api.register(unique, FAMILY);
  const me = await api.me();
  return { api, id: me!.id, name: unique };
}

async function rejects(p: Promise<unknown>, code: string, what?: string) {
  await assert.rejects(
    p,
    (e: unknown) => {
      assert.ok(e instanceof ApiError, String(e));
      assert.equal(e.code === code ? code : e.message, code, what);
      return true;
    },
    what,
  );
}

const fresh = (id: string) => startOnline({ id, size: 9, komi: 7.5, rulesVersion: RULES_VERSION, handicap: 0 });

/** Seals an action with the shared rules, the way the app does, without sending it. */
function sealed(state: OnlineGame, ev: GameEvent): { event: SealedEvent; state: OnlineGame; summary: Summary } {
  const r = seal(state, ev);
  if (!r.ok) throw new Error(`rules refused ${ev.kind}: ${r.reason}`);
  return { event: r.event, state: r.state, summary: summary(r.state) };
}

/** Seals and appends an action; returns the state after it. */
async function send(api: GoApi, gameId: string, state: OnlineGame, ev: GameEvent): Promise<OnlineGame> {
  const s = sealed(state, ev);
  await api.addEvent(gameId, s.state.events.length, s.event, s.summary);
  return s.state;
}

const pt = (name: string) => pointFromName(9, name);

after(async () => {
  for (const c of clients) {
    await c.removeAllChannels();
    await c.realtime.disconnect();
  }
});

describe('players', () => {
  it('needs the family code to become a player', async () => {
    const api = await phone();
    await rejects(api.register('Mallory', 'guess'), 'wrong_family_code');
    assert.equal(await api.me(), null);
    const [john, johnny] = [named('John Doe'), named('Johnny Doe')];
    await api.register(`  ${john} `, FAMILY);
    assert.equal((await api.me())?.name, john);
    await api.rename(johnny);
    assert.equal((await api.me())?.name, johnny);
  });

  it('a phone that is not a player sees no games or players', async () => {
    const { api, id: hostId } = await player('Host');
    await api.createGame(9, 'black');
    const stranger = await phone();
    const id = await stranger.signIn();
    assert.deepEqual(await stranger.listGames(id), []);
    assert.deepEqual(await stranger.players([hostId]), []);
    await rejects(stranger.createGame(9, 'black'), 'not_a_player');
  });

  it('nobody can read the family code', async () => {
    const { api, db } = await rawPhone();
    await api.signIn();
    const r = await db.from('settings').select('*');
    assert.deepEqual(r.data ?? [], []);
  });
});

describe('names', () => {
  it('a name belongs to one player, whatever its case and spaces', async () => {
    const first = await player('Unique');
    const second = await phone();
    await rejects(second.register(`  ${first.name.toUpperCase()} `, FAMILY), 'name_taken');
    assert.equal(await second.me(), null);
    const otherName = named('Other');
    await second.register(otherName, FAMILY);
    await rejects(second.rename(first.name.toLowerCase()), 'name_taken');
    assert.equal((await second.me())?.name, otherName);
    await first.api.rename(` ${first.name} `);
    assert.equal((await first.api.me())?.name, first.name);
  });
});

describe('finished games', () => {
  /** A golden record (or a broken one, typed as if it were whole), as a new game of this run: the database keeps rows between runs. */
  type Rec = FinishedGame & Record<string, unknown>;
  /** The record as a new game, `by` the player who sends it when given. */
  const asNew = (r: Record<string, unknown>, by?: string, change: (r: Rec) => void = () => {}): Rec => {
    const copy = { ...structuredClone(r), id: randomUUID() } as Rec;
    if (by && copy.meta) copy.meta.player = by;
    change(copy);
    return copy;
  };
  const botGame = (by: string) => asNew(readable().find(([f]) => f === 'v1/bot-9-scored.json')![1], by);
  const kept = async (id: string) => (await admin.from('game_records').select('*').eq('id', id)).data!;
  /** An online game `me` sat in as `you`, against `host`; the record names both. */
  async function seated(me: { api: GoApi; id: string }, r: Rec) {
    const host = await player('Host game');
    const id = await host.api.createGame(9, r.meta.you === 'black' ? 'white' : 'black');
    await me.api.joinGame(id);
    Object.assign(r.meta, { onlineGame: id, opponent: host.id });
    return { host, id };
  }
  /** Sends a record as JSON text, to check numbers spelled in ways `JSON.stringify` never writes. */
  async function sendText(db: SupabaseClient, json: string) {
    const token = (await db.auth.getSession()).data.session!.access_token;
    const res = await fetch(`${url}/rest/v1/rpc/record_game`, {
      method: 'POST',
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Profile': SCHEMA },
      body: `{"p": ${json}, "version": "x"}`,
    });
    return `${res.status} ${await res.text()}`;
  }

  it('keeps every golden record exactly as sent', async () => {
    const me = await player('Archivist');
    for (const [file, record] of [...readable(), ...newer().filter(([f]) => f !== 'newer/format-2.json')]) {
      const r = asNew(record, me.id);
      if (r.meta.mode === 'online') await seated(me, r);
      await me.api.recordFinishedGame(r, '1.0.0 (1)');
      const [row] = await kept(r.id);
      assert.deepEqual(row.record, r, file);
      assert.equal(row.format, 1);
      assert.equal(Date.parse(row.ended_at), Date.parse(r.endedAt));
      assert.equal(row.online_game, r.meta.onlineGame ?? null);
      assert.notEqual(readFinished(row.record), null, file);
    }
  });

  it('refuses what the phone refuses, and a format it does not know', async () => {
    const me = await player('Careful');
    for (const [name, record] of broken()) {
      // Each its own new game, except where the id is what is wrong.
      const r = name.startsWith('an id ') ? (record as Rec) : asNew(record);
      await rejects(me.api.recordFinishedGame(r, 'x'), 'bad_game', name);
    }
    await rejects(me.api.recordFinishedGame(asNew(newer().find(([f]) => f === 'newer/format-2.json')![1], me.id), 'x'), 'bad_game');
    // The phone reads past fields a later app added; the server learns them before an app sends them.
    for (const [file, record] of extended()) await rejects(me.api.recordFinishedGame(asNew(record, me.id), 'x'), 'bad_game', file);
    await rejects(me.api.recordFinishedGame(botGame(me.id), 'x'.repeat(41)), 'bad_game');
  });

  it('takes numbers only as JSON.stringify writes them', async () => {
    const db = await signedClient();
    const api = new GoApi(db, SCHEMA);
    await api.register(named('Speller'), FAMILY);
    const text = JSON.stringify(botGame((await api.me())!.id));
    for (const [from, to] of [
      ['"komi":7.5', '"komi":7.50'],
      ['"size":9', '"size":9.0'],
      ['"handicap":0', '"handicap":0.0'],
      ['"after":212', '"after":212.0'],
      ['"dead":[8', '"dead":[8.0'],
    ]) {
      assert.ok(text.includes(from), from);
      assert.match(await sendText(db, text.replace(from, to)), /^400 .*bad_game/, to);
    }
    assert.match(await sendText(db, text), /^204 /);
  });

  it('a player keeps their games once each, and sees only their own', async () => {
    const me = await rawPhone();
    await me.api.register(named('Keeper'), FAMILY);
    const myId = (await me.api.me())!.id;
    const other = await rawPhone();
    await other.api.register(named('Snooper'), FAMILY);
    const g = botGame(myId);
    await me.api.recordFinishedGame(g, '1.0.0 (1)');
    await me.api.recordFinishedGame(g, '1.0.0 (1)');
    const rows = await kept(g.id);
    assert.equal(rows.length, 1);
    assert.partialDeepStrictEqual(rows[0], { player: myId, app_version: '1.0.0 (1)' });
    assert.deepEqual((await me.db.from('game_records').select('id').eq('id', g.id)).data, [{ id: g.id }]);
    assert.deepEqual((await other.db.from('game_records').select('id').eq('id', g.id)).data, []);
    await rejects(other.api.recordFinishedGame(g, 'x'), 'not_your_game');
    // A record names the player it belongs to, and no one sends another player's games.
    await rejects(other.api.recordFinishedGame(botGame(myId), 'x'), 'not_your_game');
    await rejects(
      me.api.recordFinishedGame(
        asNew(g, undefined, (r) => delete r.meta.player),
        'x',
      ),
      'not_your_game',
    );
  });

  it('a recount replaces the kept game, but not its mode', async () => {
    const me = await player('Recounter');
    const g = botGame(me.id);
    await me.api.recordFinishedGame(g, '1.0.0 (1)');
    const recounted = { ...g, core: { ...g.core, result: { ...g.core.result, margin: g.core.result.margin! + 2 } } };
    await me.api.recordFinishedGame(recounted, '1.0.0 (2)');
    assert.partialDeepStrictEqual((await kept(g.id))[0], { record: recounted, app_version: '1.0.0 (2)' });
    await rejects(me.api.recordFinishedGame({ ...g, meta: { ...g.meta, mode: 'face_to_face', you: null } }, 'x'), 'not_your_game');
  });

  it('only family members keep games, and only online games they played, once', async () => {
    const stranger = await phone();
    await stranger.signIn();
    await rejects(stranger.recordFinishedGame(botGame(randomUUID()), 'x'), 'not_a_player');

    const me = await player('Seated');
    const outsider = await player('Not seated');
    const online = asNew(readable().find(([f]) => f === 'v1/online-19-scored.json')![1], me.id);
    const { host, id } = await seated(me, online);
    await rejects(outsider.api.recordFinishedGame({ ...online, meta: { ...online.meta, player: outsider.id } }, 'x'), 'not_your_game');
    // Only as the server's game was played: the sender's colour, and the other seat as the opponent.
    await rejects(me.api.recordFinishedGame({ ...online, meta: { ...online.meta, you: 'black' } }, 'x'), 'not_your_game');
    await rejects(me.api.recordFinishedGame({ ...online, meta: { ...online.meta, opponent: outsider.id } }, 'x'), 'not_your_game');
    assert.equal(online.meta.opponent, host.id);
    await me.api.recordFinishedGame(online, 'x');
    // A second record of the same online game, under another id, is not kept.
    await me.api.recordFinishedGame({ ...online, id: randomUUID() }, 'x');
    assert.equal((await admin.from('game_records').select('id').eq('online_game', id).eq('player', me.id)).data?.length, 1);
  });
});

describe('history', () => {
  const golden = (file: string, by: string) => {
    const r = structuredClone(readable().find(([f]) => f === file)![1]) as unknown as FinishedGame;
    return { ...r, id: randomUUID(), meta: { ...r.meta, player: by } } as FinishedGame;
  };
  const before = '2026-10-22T08:00:00.000Z';

  it('the server works out the rating from the records since the level was chosen', async () => {
    const me = await player('Climber');
    const reader = await player('Family');
    await me.api.setMyLevel('casual', before);
    assert.partialDeepStrictEqual(await me.api.me(), { level: 'casual', rating: 650, rated_games: 0 });
    assert.equal(Date.parse((await me.api.me())!.rating_since!), Date.parse(before));
    // 150 → 212 moves the rating 62; sent again and recounted, it still counts once.
    const g = golden('v1/bot-9-scored.json', me.id);
    await me.api.recordFinishedGame(g, 'x');
    await me.api.recordFinishedGame(g, 'x');
    await me.api.recordFinishedGame({ ...g, core: { ...g.core, result: { ...g.core.result, margin: 30.5 } } }, 'x');
    assert.partialDeepStrictEqual(await me.api.me(), { rating: 712, rated_games: 1 });
    // 900 → 880, and an unrated game counts nothing.
    await me.api.recordFinishedGame(golden('v1/bot-9-handicap-2-scored.json', me.id), 'x');
    await me.api.recordFinishedGame(golden('v1/face-to-face-9-resumed.json', me.id), 'x');
    assert.partialDeepStrictEqual(await reader.api.players([me.id]), [{ rating: 692, rated_games: 2, level: 'casual' }]);
    // A new level starts again; games that ended before it no longer count, and an older choice arriving late changes nothing.
    const now = new Date().toISOString();
    await me.api.setMyLevel('club', now);
    assert.partialDeepStrictEqual(await me.api.me(), { level: 'club', rating: 1650, rated_games: 0 });
    await me.api.setMyLevel('never', before);
    assert.partialDeepStrictEqual(await me.api.me(), { level: 'club', rating: 1650 });
    assert.equal(Date.parse((await me.api.me())!.rating_since!), Date.parse(now));
  });

  it('refuses a level it does not know, a time in the future, and anyone outside the family', async () => {
    const me = await player('Leveller');
    await rejects(me.api.setMyLevel('pro' as 'dan', before), 'bad_level');
    await rejects(me.api.setMyLevel('dan', new Date(Date.now() + 3 * 86_400_000).toISOString()), 'bad_level');
    const stranger = await phone();
    await stranger.signIn();
    await rejects(stranger.setMyLevel('dan', before), 'not_a_player');
    assert.deepEqual(await stranger.myRecords(null), []);
  });

  it('an online game sent from two phones of one account counts once', async () => {
    const me = await player('Two phones');
    await me.api.setMyLevel('intermediate', '2026-10-01T00:00:00.000Z');
    const g = golden('v1/online-19-scored.json', me.id);
    const host = await player('Host online');
    const game = await host.api.createGame(19, g.meta.you === 'black' ? 'white' : 'black');
    await me.api.joinGame(game);
    const online = { ...g, meta: { ...g.meta, onlineGame: game, opponent: host.id } };
    await me.api.recordFinishedGame(online, 'x');
    await me.api.recordFinishedGame({ ...online, id: randomUUID() }, 'x');
    assert.partialDeepStrictEqual(await me.api.me(), { rating: 1165, rated_games: 1 });
  });

  it('a player reads their own records back, a page at a time, from where they stopped', async () => {
    const me = await player('Historian');
    const other = await player('Nosy');
    const games = ['v1/bot-9-scored.json', 'v1/face-to-face-9-resumed.json', 'v1/bot-13-handicap-3-resign.json'].map((f) =>
      golden(f, me.id),
    );
    for (const g of games) await me.api.recordFinishedGame(g, 'x');
    const first = await me.api.myRecords(null, 2);
    assert.deepEqual(
      first.map((r) => r.id),
      games.slice(0, 2).map((g) => g.id),
    );
    assert.deepEqual(first[0].record, games[0]);
    const last = first[first.length - 1];
    const rest = await me.api.myRecords({ uploadedAt: last.uploaded_at, id: last.id }, 2);
    assert.deepEqual(
      rest.map((r) => r.id),
      [games[2].id],
    );
    // A recount comes again, after what was read.
    const end = rest[0];
    await me.api.recordFinishedGame({ ...games[0], core: { ...games[0].core, result: { ...games[0].core.result, margin: 30.5 } } }, 'x');
    assert.deepEqual(
      (await me.api.myRecords({ uploadedAt: end.uploaded_at, id: end.id })).map((r) => r.id),
      [games[0].id],
    );
    assert.deepEqual(await other.api.myRecords(null), []);
  });
});

describe('avatars', () => {
  it('a player sets or clears their own avatar, and the family reads it with their name', async () => {
    const me = await player('Fox');
    const other = await player('Watcher');
    assert.equal((await me.api.me())?.avatar, null);
    await me.api.setMyAvatar('🦊');
    assert.partialDeepStrictEqual(await other.api.players([me.id]), [{ id: me.id, name: me.name, avatar: '🦊' }]);
    await me.api.setMyAvatar(null);
    assert.equal((await me.api.me())?.avatar, null);
    await rejects(me.api.setMyAvatar('x'.repeat(17)), 'bad_avatar');
    await rejects(me.api.setMyAvatar(''), 'bad_avatar');
    const stranger = await phone();
    await stranger.signIn();
    await rejects(stranger.setMyAvatar('🐱'), 'not_a_player');
  });
});

describe('presence and asking to play', () => {
  it('the family sees when a member was last seen, and a phone can only say so every so often', async () => {
    const a = await player('Presence');
    const b = await player('Watcher');
    assert.equal(
      (await b.api.seenPlayers(b.id)).some((p) => p.id === a.id),
      false,
    );
    await a.api.touchPresence();
    const first = (await b.api.seenPlayers(b.id)).find((p) => p.id === a.id)?.last_seen_at;
    assert.ok(first && Date.now() - Date.parse(first) < 60_000);
    await a.api.touchPresence();
    assert.equal((await b.api.seenPlayers(b.id)).find((p) => p.id === a.id)?.last_seen_at, first);
    const stranger = await phone();
    await stranger.signIn();
    await rejects(stranger.touchPresence(), 'not_a_player');
  });

  it('only the member asked can join the game, and it is addressed to them in the list', async () => {
    const a = await player('Asker');
    const b = await player('Asked');
    const c = await player('Bystander');
    const id = await a.api.askToPlay(b.id, 9, 'black');
    assert.equal((await c.api.listGames(c.id)).find((g) => g.id === id)?.invited, b.id);
    await rejects(c.api.joinGame(id), 'not_invited');
    await rejects(a.api.joinGame(id), 'own_game');
    await b.api.joinGame(id);
    assert.partialDeepStrictEqual((await a.api.loadGame(id)).game, { status: 'playing', black: a.id, white: b.id });
    await rejects(a.api.askToPlay(a.id, 9, 'black'), 'bad_player');
    await rejects(a.api.askToPlay(randomUUID(), 9, 'black'), 'bad_player');
    const again = await a.api.askToPlay(b.id, 9, 'white');
    await a.api.cancelGame(again);
  });
});

describe('lobby', () => {
  it('create, list, join, and only one opponent gets the seat', async () => {
    const a = await player('Anna');
    const b = await player('Bertil');
    const c = await player('Cecilia');
    const id = await a.api.createGame(9, 'white');

    const seen = await b.api.listGames(b.id);
    assert.partialDeepStrictEqual(
      seen.find((g) => g.id === id),
      { status: 'open', white: a.id, black: null, size: 9 },
    );

    await rejects(a.api.joinGame(id), 'own_game');
    await b.api.joinGame(id);
    await rejects(c.api.joinGame(id), 'game_not_open');

    const { game } = await a.api.loadGame(id);
    assert.partialDeepStrictEqual(game, { status: 'playing', black: b.id, white: a.id, to_play: 'black', move_count: 0 });
    assert.equal(
      (await c.api.listGames(c.id)).some((g) => g.id === id),
      false,
    );
    assert.equal(
      (await a.api.listGames(a.id)).some((g) => g.id === id),
      true,
    );
  });

  it('only the creator can cancel, and only while open', async () => {
    const a = await player('Anna');
    const b = await player('Bertil');
    const id = await a.api.createGame(13, 'black');
    await rejects(b.api.cancelGame(id), 'game_not_open');
    await a.api.cancelGame(id);
    assert.equal(
      (await a.api.listGames(a.id)).some((g) => g.id === id),
      false,
    );
  });

  it('a live game stays listed however many games were opened since', async () => {
    const a = await player('Anna');
    const b = await player('Bertil');
    const live = await a.api.createGame(9, 'black');
    await b.api.joinGame(live);
    // One player keeps at most 10 open games, so six players open the 51 that once pushed it off.
    const opened: { api: GoApi; id: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const c = await player('Cecilia');
      for (let j = 0; j < 9 && opened.length < 51; j++) opened.push({ api: c.api, id: await c.api.createGame(9, 'black') });
    }
    try {
      const listed = await a.api.listGames(a.id);
      assert.ok(listed.some((g) => g.id === live));
      assert.ok(listed.some((g) => g.id === opened[50].id));
    } finally {
      for (const o of opened) await o.api.cancelGame(o.id);
    }
  });

  it('one player keeps at most 10 open games', async () => {
    const a = await player('Anna');
    const opened: string[] = [];
    for (let i = 0; i < 10; i++) opened.push(await a.api.createGame(9, 'black'));
    await assert.rejects(a.api.createGame(9, 'black'), /too_many_open_games/);
    await a.api.cancelGame(opened[0]);
    opened[0] = await a.api.createGame(9, 'black');
    for (const id of opened) await a.api.cancelGame(id);
  });
});

describe('playing', () => {
  async function newGame() {
    const black = await player('Black');
    const white = await player('White');
    const id = await black.api.createGame(9, 'black');
    await white.api.joinGame(id);
    return { black, white, id };
  }

  it('enforces turn order, event order and seats', async () => {
    const { black, white, id } = await newGame();
    const outsider = await player('Outsider');
    let s = fresh(id);
    const first = sealed(s, { kind: 'play', color: 'black', point: pt('E5') });

    await rejects(white.api.addEvent(id, 1, first.event, first.summary), 'wrong_color');
    await rejects(outsider.api.addEvent(id, 1, first.event, first.summary), 'not_your_game');
    await rejects(black.api.addEvent(id, 2, first.event, first.summary), 'out_of_sync');
    const whiteFirst = { ...sealed(s, { kind: 'resign', color: 'black' }).event, kind: 'play', color: 'white', point: pt('E5') };
    await rejects(white.api.addEvent(id, 1, whiteFirst as SealedEvent, first.summary), 'not_your_turn');

    s = await send(black.api, id, s, { kind: 'play', color: 'black', point: pt('E5') });
    await rejects(black.api.addEvent(id, 1, first.event, first.summary), 'out_of_sync');
    s = await send(white.api, id, s, { kind: 'play', color: 'white', point: pt('C3') });

    const loaded = await white.api.loadGame(id);
    assert.partialDeepStrictEqual(loaded.game, { move_count: 2, to_play: 'black', status: 'playing', head_hash: s.head });
    assert.deepEqual(
      loaded.events.map((e) => e.event),
      s.events,
    );
  });

  it('a handicap game: White moves first and both sides hash the setup', async () => {
    const black = await player('Black');
    const white = await player('White');
    const id = await black.api.createGame(9, 'black', 3);
    await white.api.joinGame(id);
    const row = await white.api.gameRow(id);
    assert.partialDeepStrictEqual(row, { rules_version: RULES_VERSION, handicap: 3, to_play: 'white' });
    assert.equal(Number(row.komi), 3.5);
    let s = startOnline({
      id,
      size: 9,
      komi: Number(row.komi),
      rulesVersion: row.rules_version,
      handicap: row.handicap,
    });
    const blackFirst = sealed(s, { kind: 'resign', color: 'black' });
    await rejects(black.api.addEvent(id, 1, { ...blackFirst.event, kind: 'pass' } as SealedEvent, blackFirst.summary), 'not_your_turn');
    s = await send(white.api, id, s, { kind: 'play', color: 'white', point: pt('E5') });
    s = await send(black.api, id, s, { kind: 'play', color: 'black', point: pt('D5') });
    assert.equal((await white.api.gameRow(id)).head_hash, s.head);
  });

  it('a one-stone game: Black moves first on an empty board with ½ komi', async () => {
    const black = await player('Black');
    const white = await player('White');
    const id = await white.api.createGame(9, 'white', 1);
    await black.api.joinGame(id);
    const row = await black.api.gameRow(id);
    assert.partialDeepStrictEqual(row, { rules_version: RULES_VERSION, handicap: 1, to_play: 'black' });
    assert.equal(Number(row.komi), 0.5);
    let s = startOnline({ id, size: 9, komi: Number(row.komi), rulesVersion: row.rules_version, handicap: row.handicap });
    s = await send(black.api, id, s, { kind: 'play', color: 'black', point: pt('E5') });
    assert.equal((await white.api.gameRow(id)).head_hash, s.head);
  });

  it('creates every game at the current rules version under Chinese rules, and refuses a bad setup', async () => {
    const p = await rawPhone();
    await p.api.register(named('Setup'), FAMILY);
    const even = await p.api.gameRow(await p.api.createGame(19, 'black'));
    assert.partialDeepStrictEqual(even, { rules_version: RULES_VERSION, handicap: 0, to_play: 'black' });
    assert.equal(Number(even.komi), 7.5);
    const nine = await p.api.gameRow(await p.api.createGame(13, 'white', 9));
    assert.partialDeepStrictEqual(nine, { handicap: 9, to_play: 'white' });
    assert.equal(Number(nine.komi), 9.5);
    assert.equal((await p.api.gameRow(await p.api.createGame(9, 'black', 5))).handicap, 5);
    await rejects(p.api.createGame(9, 'black', 6), 'bad_setup');
    await rejects(p.api.createGame(19, 'black', 10), 'bad_setup');
    await rejects(p.api.createGame(19, 'black', -1), 'bad_setup');
  });

  it('computes the same genesis hash as the phones, and refuses events off the chain head', async () => {
    const { black, white, id } = await newGame();
    const s = fresh(id);
    const ok = sealed(s, { kind: 'pass', color: 'black' });
    const otherGame = sealed(fresh('00000000-0000-0000-0000-000000000000'), { kind: 'pass', color: 'black' });
    await rejects(black.api.addEvent(id, 1, otherGame.event, otherGame.summary), 'broken_chain');
    await black.api.addEvent(id, 1, ok.event, ok.summary);
    // White replays the first event but builds on the genesis again instead of the new head.
    const stale = sealed(s, { kind: 'resign', color: 'black' });
    await rejects(white.api.addEvent(id, 2, { ...stale.event, color: 'white' }, { ...stale.summary }), 'broken_chain');
  });

  it('refuses malformed events', async () => {
    const { black, id } = await newGame();
    const s = fresh(id);
    const good = sealed(s, { kind: 'play', color: 'black', point: pt('E5') });
    const bad: unknown[] = [
      { ...good.event, extra: 1 },
      { ...good.event, point: 81 },
      { ...good.event, point: -1 },
      { ...good.event, point: 2.5 },
      { ...good.event, point: '3' },
      { ...good.event, hash: 'nothex' },
      { ...good.event, kind: 'undo' },
      { kind: 'pass', color: 'black', prev: good.event.prev, hash: good.event.hash, dead: [81] },
    ];
    for (const ev of bad) await rejects(black.api.addEvent(id, 1, ev as SealedEvent, good.summary), 'bad_event');
  });

  it('refuses summaries that do not follow from the event', async () => {
    const { black, white, id } = await newGame();
    let s = fresh(id);
    const play = sealed(s, { kind: 'play', color: 'black', point: pt('E5') });
    await rejects(black.api.addEvent(id, 1, play.event, { ...play.summary, status: 'over' }), 'bad_summary');
    await rejects(black.api.addEvent(id, 1, play.event, { ...play.summary, toPlay: 'black' }), 'bad_summary');
    const resign = sealed(s, { kind: 'resign', color: 'black' });
    await rejects(
      black.api.addEvent(id, 1, resign.event, { ...resign.summary, result: { winner: 'black', reason: 'resignation' } }),
      'bad_summary',
    );
    // A pass that is not the second in a row must not start scoring, and must carry no dead list.
    const firstPass = sealed(s, { kind: 'pass', color: 'black' });
    await rejects(black.api.addEvent(id, 1, firstPass.event, { ...firstPass.summary, status: 'scoring' }), 'bad_summary');

    s = await send(black.api, id, s, { kind: 'pass', color: 'black' });
    const second = sealed(s, { kind: 'pass', color: 'white' });
    await rejects(white.api.addEvent(id, 2, second.event, { ...second.summary, status: 'playing' }), 'bad_summary');
    const noDead: SealedEvent = { kind: 'pass', color: 'white', prev: second.event.prev, hash: second.event.hash };
    await rejects(white.api.addEvent(id, 2, noDead, second.summary), 'bad_summary');
    s = await send(white.api, id, s, { kind: 'pass', color: 'white' });

    // Scoring: ending needs both acceptances, each only once.
    const accept = sealed(s, { kind: 'accept', color: 'black' });
    await rejects(
      black.api.addEvent(id, 3, accept.event, {
        status: 'over',
        toPlay: accept.summary.toPlay,
        result: { winner: 'black', reason: 'score', margin: 1, black: 1, white: 0 },
      }),
      'bad_summary',
    );
    s = await send(black.api, id, s, { kind: 'accept', color: 'black' });
    const again = { ...sealed(s, { kind: 'accept', color: 'white' }).event, color: 'black' } as SealedEvent;
    await rejects(black.api.addEvent(id, 4, again, summary(s)), 'already_accepted');
    await rejects(black.api.addEvent(id, 4, { ...again, kind: 'play', point: 3 } as SealedEvent, summary(s)), 'not_your_turn');
    s = await send(white.api, id, s, { kind: 'accept', color: 'white' });
    assert.equal((await black.api.gameRow(id)).status, 'over');
  });

  it('two phones play to a result they both verify, then nothing more is accepted', async () => {
    const { black, white, id } = await newGame();
    const problems: IntegrityProblem[] = [];
    const b = new MatchSync(black.api, id, black.id, (p) => problems.push(p));
    const w = new MatchSync(white.api, id, white.id, (p) => problems.push(p));
    await b.refresh();
    await w.refresh();
    const steps: [MatchSync, GameEvent][] = [
      [b, { kind: 'play', color: 'black', point: pt('E5') }],
      [w, { kind: 'pass', color: 'white' }],
      [b, { kind: 'pass', color: 'black' }],
      [w, { kind: 'accept', color: 'white' }],
      [b, { kind: 'accept', color: 'black' }],
    ];
    for (const [phone, ev] of steps) {
      await phone.refresh();
      assert.deepEqual(await phone.act(ev), { ok: true });
    }
    const end = await w.refresh();
    assert.equal(end.kind, 'ready');
    if (end.kind !== 'ready') return;
    assert.deepEqual(end.row.result, { winner: 'black', reason: 'score', margin: 73.5, black: 81, white: 7.5 });
    assert.equal(end.row.head_hash, end.state.head);
    assert.deepEqual(problems, []);
    assert.deepEqual(await w.act({ kind: 'resign', color: 'white' }), { ok: false, problem: { kind: 'illegal', reason: 'gameOver' } });
  });

  it('a stored move changed behind the phones’ backs stops the game for both', async () => {
    const { black, white, id } = await newGame();
    const problems: IntegrityProblem[] = [];
    const b = new MatchSync(black.api, id, black.id, (p) => problems.push(p));
    const w = new MatchSync(white.api, id, white.id, (p) => problems.push(p));
    await b.refresh();
    await b.act({ kind: 'play', color: 'black', point: pt('E5') });
    await w.refresh();
    await w.act({ kind: 'play', color: 'white', point: pt('C3') });

    const changed = await admin
      .from('game_events')
      .update({ event: { ...((await white.api.loadGame(id)).events[1].event as object), point: pt('G7') } })
      .eq('game_id', id)
      .eq('n', 2);
    assert.equal(changed.error, null);

    assert.partialDeepStrictEqual(await b.refresh(), { kind: 'stopped', n: 2, reason: 'hashMismatch' });
    assert.partialDeepStrictEqual(await black.api.gameRow(id), { status: 'disputed', dispute: { n: 2, reason: 'hashMismatch' } });
    assert.partialDeepStrictEqual(await w.refresh(), { kind: 'stopped', n: 2 });
    assert.equal(problems.length, 1);
    const next = sealed(fresh(id), { kind: 'pass', color: 'black' });
    await rejects(black.api.addEvent(id, 3, next.event, next.summary), 'game_disputed');
  });

  it('a game keeps at most 2000 events', async () => {
    const { black, id } = await newGame();
    const event = (n: number) => admin.from('game_events').insert({ game_id: id, n, player: black.id, event: {} });
    assert.match((await event(2001)).error?.message ?? '', /game_too_long/);
    assert.equal((await event(2000)).error, null);
  });

  it('only the two players can stop a game', async () => {
    const { id } = await newGame();
    const outsider = await player('Outsider');
    await rejects(outsider.api.disputeGame(id, 1, 'nope'), 'not_your_game');
  });

  it('a game can be stopped only while it is played, at an event it has', async () => {
    const { black, white, id } = await newGame();
    const s = await send(black.api, id, fresh(id), { kind: 'play', color: 'black', point: pt('E5') });
    await rejects(white.api.disputeGame(id, 2, 'ahead'), 'bad_event');
    await rejects(white.api.disputeGame(id, -1, 'behind'), 'bad_event');
    await send(white.api, id, s, { kind: 'resign', color: 'white' });
    await rejects(white.api.disputeGame(id, 1, 'sore loser'), 'game_not_running');
    assert.equal((await black.api.gameRow(id)).status, 'over');

    const host = await player('Waiting');
    const open = await host.api.createGame(9, 'black');
    await rejects(host.api.disputeGame(open, 0, 'nobody came'), 'game_not_running');
  });

  it('delivers the opponent’s move in real time', async () => {
    const { black, white, id } = await newGame();
    const received = new Promise<EventRow>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('no realtime event within 10 s')), 10_000);
      let stop = () => {};
      const ready = new Promise<void>((r) => {
        stop = white.api.watchGame(id, {
          event: (e) => {
            clearTimeout(timeout);
            stop();
            resolve(e);
          },
          game: () => {},
          ready: r,
        });
      });
      void ready.then(() => send(black.api, id, fresh(id), { kind: 'play', color: 'black', point: pt('D4') }));
    });
    assert.partialDeepStrictEqual(await received, { n: 1, event: { kind: 'play', color: 'black', point: pt('D4') } });
  });
});

const report0 = () => ({ kind: 'bug' as const, message: 'signed out', details: {} });

describe('reports', () => {
  it('family members send reports but cannot read them or set their status', async () => {
    const { api, db } = await rawPhone();
    await api.register(named('Reporter'), FAMILY);
    const fingerprint = `test-${Date.now()}`;
    await api.sendReports([
      {
        kind: 'crash',
        message: 'TypeError: boom',
        details: { stack: 'at x' },
        fingerprint,
        occurrences: 3,
        app_version: '1.0.0 (1)',
      },
    ]);
    assert.deepEqual((await db.from('reports').select('*')).data ?? [], []);
    const forged = await db.from('reports').insert({ kind: 'bug', message: 'x', status: 'released' });
    assert.notEqual(forged.error, null);

    const stored = await admin.from('reports').select('kind,message,occurrences,status,player_id').eq('fingerprint', fingerprint);
    assert.deepEqual(stored.data, [
      { kind: 'crash', message: 'TypeError: boom', occurrences: 3, status: 'new', player_id: await api.signIn() },
    ]);
  });

  it('a signed-in phone outside the family cannot send reports', async () => {
    const stranger = await phone();
    const message = `stranger ${Date.now()}`;
    await assert.rejects(stranger.sendReports([{ kind: 'bug', message, details: {} }]), ApiError);
    assert.deepEqual((await admin.from('reports').select('id').eq('message', message)).data, []);
  });

  const report = (i: number) => ({ kind: 'bug' as const, message: `flood ${i}`, details: {} });

  it('one phone sends a full queue in an hour, and nothing more', async () => {
    const { api } = await player('Flood');
    await api.sendReports(Array.from({ length: 50 }, (_, i) => report(i)));
    await rejects(api.sendReports([report(50)]), 'too_many_reports');
  });

  it('the project takes a limited number of reports a day from everyone together', async () => {
    const before = (await admin.from('settings').select('value').eq('key', 'reports_per_day').maybeSingle()).data;
    assert.equal((await admin.from('settings').upsert({ key: 'reports_per_day', value: '0' })).error, null);
    try {
      await rejects((await player('Capped')).api.sendReports([report(0)]), 'too_many_reports');
    } finally {
      await (before
        ? admin.from('settings').upsert({ key: 'reports_per_day', value: before.value })
        : admin.from('settings').delete().eq('key', 'reports_per_day'));
    }
  });
});

describe('releases', () => {
  it('phones can see the latest published version', async () => {
    const r = await admin.from('releases').upsert([
      { version_code: 1, version_name: '1.0.0', notes: '' },
      { version_code: 7, version_name: '1.1.0', notes: 'Online play' },
    ]);
    assert.equal(r.error, null);
    const api = await phone();
    await api.signIn();
    assert.deepEqual(await api.latestRelease(), { version_code: 7, version_name: '1.1.0', notes: 'Online play' });
  });
});

it('loads histories beyond the API page limit and refuses missing events', async () => {
  const p = await player('Long history');
  const id = await p.api.createGame(9, 'black');
  const events = Array.from({ length: 1001 }, (_, index) => ({
    game_id: id,
    n: index + 1,
    player: p.id,
    event: { kind: 'pass', color: index % 2 ? 'white' : 'black' },
  }));
  const inserted = await admin.from('game_events').insert(events);
  assert.equal(inserted.error, null);
  const updated = await admin.from('games').update({ move_count: events.length }).eq('id', id);
  assert.equal(updated.error, null);
  const loaded = await p.api.loadGame(id);
  assert.equal(loaded.events.length, 1001);
  assert.equal(loaded.events[1000].n, 1001);
  const removed = await admin.from('game_events').delete().eq('game_id', id).eq('n', 500);
  assert.equal(removed.error, null);
  await rejects(p.api.loadGame(id), 'out_of_sync');
});

it('concurrent work on one phone keeps one email identity', async () => {
  const api = await phone();
  const ids = await Promise.all([api.signIn(), api.signIn(), api.signIn()]);
  assert.equal(new Set(ids).size, 1);
  assert.equal(await api.signIn(), ids[0]);
});

it('a phone that is not signed in is refused before it reaches the database', async () => {
  const api = new GoApi(client(), SCHEMA);
  await rejects(api.signIn(), 'not_signed_in');
  await rejects(api.createGame(9, 'black'), 'not_signed_in');
  await rejects(api.sendReports([report0()]), 'not_signed_in');
});
