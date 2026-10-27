/**
 * What players do online, from start to finish, through the same classes the Online screen
 * drives (Lobby and MatchSync) against the local Supabase stack. Each phone is a separate
 * permanent email sign-in. Real games come from src/go/__tests__/games (sources and licences there).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { estimateDead } from '../../src/go/ai';
import { BLACK, chainAt, Color, pointFromName } from '../../src/go/rules';
import { parseSgf, replaySgf, SgfGame } from '../../src/go/sgf';
import { GoApi } from '../../src/net/api';
import { authAdmin, emailSession } from '../../scripts/lib/test-identity';
import { Lobby } from '../../src/net/lobby';
import { IntegrityProblem, MatchSync, MatchView } from '../../src/net/match';
import { GameEvent } from '../../src/online/log';

const SCHEMA = process.env.SUPABASE_SCHEMA ?? 'public';
const FAMILY = 'local-family';
const LONG = { timeout: 120_000 };

const clients: SupabaseClient[] = [];
after(async () => {
  for (const c of clients) {
    await c.removeAllChannels();
    await c.realtime.disconnect();
  }
});

/** A phone with the app's lobby; `id` once it has joined the family. */
function phone() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  clients.push(db);
  const api = new GoApi(db, SCHEMA);
  return { db, api, lobby: new Lobby(api, (e) => assert.fail(`lobby reported ${String(e)}`)) };
}

// Names are unique and the database keeps players between runs, so every name carries its own mark.
const RUN = Date.now().toString(36).slice(-5);
let registered = 0;
const named = (name: string) => `${name} ${RUN}${++registered}`;

const admin = authAdmin();
clients.push(admin);

async function member(name: string) {
  const p = phone();
  await emailSession(admin, p.db);
  assert.equal(await p.lobby.register(named(name), FAMILY), true);
  return { ...p, id: p.lobby.state().me!.id };
}

type Member = Awaited<ReturnType<typeof member>>;

/** Black creates a 9×9 game, White joins it from the lobby, and both open it. */
async function match(black: Member, white: Member) {
  const id = (await black.lobby.create(9, 'black'))!;
  await white.lobby.refresh();
  assert.equal(await white.lobby.open(id), id);
  const problems: IntegrityProblem[] = [];
  const sync = (m: Member) => new MatchSync(m.api, id, m.id, (p) => problems.push(p));
  const seats = { black: sync(black), white: sync(white) };
  await seats.black.refresh();
  await seats.white.refresh();
  return { id, seats, problems };
}

/** The phone sees anything new first, as the screen does before a tap. */
async function act(sync: MatchSync, ev: GameEvent) {
  await sync.refresh();
  assert.deepEqual(await sync.act(ev), { ok: true }, `${ev.kind} by ${ev.color}`);
}

const noProblem = (p: IntegrityProblem) => assert.fail(`integrity problem: ${JSON.stringify(p)}`);

const ready = (v: MatchView) => {
  assert.equal(v.kind, 'ready', `view is ${v.kind}`);
  return v as Extract<MatchView, { kind: 'ready' }>;
};

const game = (file: string): SgfGame => parseSgf(readFileSync(join(__dirname, '../../src/go/__tests__/games', file), 'latin1'));

/** Plays a record's moves, each from the phone of the colour that made it, up to the passes that start counting. */
async function playRecord(seats: Record<Color, MatchSync>, g: SgfGame) {
  for (const m of g.moves) {
    const view = ready(await seats[m.color].refresh());
    if (view.state.game.phase !== 'playing') break;
    await act(seats[m.color], m.point === null ? { kind: 'pass', color: m.color } : { kind: 'play', color: m.color, point: m.point });
  }
}

/** Marks chains until the dead stones are exactly `wanted`, as a player tapping stones does. */
async function markUntil(sync: MatchSync, color: Color, wanted: ReadonlySet<number>) {
  for (;;) {
    const g = ready(await sync.refresh()).state.game;
    const wrong = g.board.findIndex((s, p) => s !== 0 && g.dead.has(p) !== wanted.has(p));
    if (wrong < 0) return;
    await act(sync, { kind: 'mark', color, point: wrong });
  }
}

const margin = (v: MatchView) => {
  const r = ready(v).row.result!;
  assert.equal(r.reason, 'score');
  return (r.winner === 'black' ? 1 : -1) * Number((r as { margin: number }).margin);
};

describe('joining the family', () => {
  it('a wrong family code is explained; the right one joins; a new name shows on the other phones', async () => {
    const [first, renamed] = [named('Jane Doe'), named('Jane Roe')];
    const p = phone();
    await emailSession(admin, p.db);
    await p.lobby.refresh();
    assert.equal(p.lobby.state().me, null);
    assert.equal(await p.lobby.register(first, 'not-the-code'), false);
    assert.equal(p.lobby.state().problem, 'wrongFamilyCode');
    assert.equal(p.lobby.state().me, null);

    assert.equal(await p.lobby.register(`  ${first}  `, FAMILY), true);
    assert.equal(p.lobby.state().problem, null);
    assert.equal(p.lobby.state().me?.name, first);

    assert.equal(await p.lobby.rename(renamed), true);
    const other = await member('Grandson');
    const id = (await p.lobby.create(9, 'white'))!;
    await other.lobby.refresh();
    assert.equal(other.lobby.state().nameOf(other.lobby.state().games.find((g) => g.id === id)!.created_by), renamed);
  });
});

describe('finding a game', () => {
  it('a game shows in the family lobby until someone joins; a third phone is told it was taken', async () => {
    const [a, b, c] = [await member('A'), await member('B'), await member('C')];
    const id = (await a.lobby.create(13, 'white'))!;
    await b.lobby.refresh();
    await c.lobby.refresh();
    assert.partialDeepStrictEqual(
      b.lobby.state().games.find((g) => g.id === id),
      { status: 'open', size: 13, white: a.id, black: null },
    );

    assert.equal(await b.lobby.open(id), id);
    assert.equal(await c.lobby.open(id), null);
    assert.equal(c.lobby.state().problem, 'gameTaken');
    await c.lobby.refresh();
    assert.equal(
      c.lobby.state().games.some((g) => g.id === id),
      false,
      'a taken game leaves the other phones’ lobbies',
    );

    // Both players find it again among their own games, and opening it does not join again.
    await a.lobby.refresh();
    assert.partialDeepStrictEqual(
      a.lobby.state().games.find((g) => g.id === id),
      { status: 'playing', black: b.id },
    );
    assert.equal(await a.lobby.open(id), id);
    const view = ready(await new MatchSync(b.api, id, b.id, noProblem).refresh());
    assert.equal(view.you, 'black');
    assert.equal(view.turn, 'yours');
  });

  it('the creator can withdraw a game nobody joined; then it is gone for everyone', async () => {
    const [a, b] = [await member('A'), await member('B')];
    const id = (await a.lobby.create(19, 'black'))!;
    assert.equal(await b.lobby.cancel(id), false, 'only the creator can withdraw it');
    assert.equal(await a.lobby.cancel(id), true);
    await b.lobby.refresh();
    assert.equal(
      b.lobby.state().games.some((g) => g.id === id),
      false,
    );
    assert.equal(await b.lobby.open(id), null);
    assert.equal(b.lobby.state().problem, 'gameTaken');
  });
});

describe('playing a whole game', () => {
  it('a real game played out to the end: both phones count the recorded result', LONG, async () => {
    // Computer Go Server game 42896, Tromp-Taylor rules, komi 7.5, every dead stone captured: W+12.5.
    const record = game('gnugo/cgos/42896.sgf');
    const { seats, problems } = await match(await member('Black'), await member('White'));
    await playRecord(seats, record);

    const counting = ready(await seats.black.refresh());
    assert.equal(counting.turn, 'scoring');
    assert.deepEqual(counting.state.game.board, replaySgf(record).board, 'captures took the same stones off');
    assert.equal(counting.state.game.dead.size, 0);
    await act(seats.white, { kind: 'accept', color: 'white' });
    await act(seats.black, { kind: 'accept', color: 'black' });

    const [b, w] = [await seats.black.refresh(), await seats.white.refresh()];
    assert.equal(margin(b), -12.5);
    assert.equal(ready(w).turn, 'over');
    assert.equal(ready(w).state.head, ready(b).state.head);
    assert.deepEqual(problems, []);
  });

  it('marking dead stones: either player fixes the suggestion, and acceptances start over after a change', LONG, async () => {
    // A KGS computer tournament game under Chinese rules, ended with dead stones on the board: W+34.5.
    const record = game('gnugo/area/kgs-tournament8-CrazyStone-GNU.sgf');
    const { seats, problems } = await match(await member('Black'), await member('White'));
    await playRecord(seats, record);
    const end = replaySgf(record);
    const reference = new Set(estimateDead(end));
    assert.ok(reference.size > 0);

    // Black accepts too early, before White's correction; the change asks Black again.
    await seats.black.refresh();
    const before = ready(await seats.black.refresh()).state.game.dead;
    const extra = [...end.board.keys()].find((p) => end.board[p] === BLACK && !reference.has(p) && !before.has(p))!;
    await act(seats.black, { kind: 'accept', color: 'black' });
    await act(seats.white, { kind: 'mark', color: 'white', point: extra });
    assert.equal(ready(await seats.black.refresh()).state.accepted.black, false);
    assert.ok(chainAt(end.board, end.size, extra).stones.every((p) => ready(seats.black.view()).state.game.dead.has(p)));

    await markUntil(seats.black, 'black', reference);
    await act(seats.black, { kind: 'accept', color: 'black' });
    await act(seats.white, { kind: 'accept', color: 'white' });
    assert.equal(margin(await seats.white.refresh()), -34.5);
    assert.deepEqual(problems, []);
  });

  it('a player who disagrees keeps playing; the game goes on and is counted later', LONG, async () => {
    const { seats, problems } = await match(await member('Black'), await member('White'));
    const at = (name: string) => pointFromName(9, name);
    for (const [color, name] of [
      ['black', 'C5'],
      ['white', 'G5'],
      ['black', 'D5'],
      ['white', 'F5'],
    ] as const)
      await act(seats[color], { kind: 'play', color, point: at(name) });
    await act(seats.black, { kind: 'pass', color: 'black' });
    await act(seats.white, { kind: 'pass', color: 'white' });
    assert.equal(ready(await seats.black.refresh()).turn, 'scoring');

    await act(seats.black, { kind: 'resume', color: 'black' });
    const resumed = ready(await seats.white.refresh());
    assert.equal(resumed.state.game.phase, 'playing');
    const next = resumed.state.game.toPlay;
    assert.equal(resumed.turn, next === 'white' ? 'yours' : 'theirs');
    await act(seats[next], { kind: 'play', color: next, point: at('E5') });
    const after = next === 'black' ? 'white' : 'black';
    await act(seats[after], { kind: 'pass', color: after });
    await act(seats[next], { kind: 'pass', color: next });
    await act(seats.white, { kind: 'accept', color: 'white' });
    await act(seats.black, { kind: 'accept', color: 'black' });
    assert.equal(ready(await seats.black.refresh()).turn, 'over');
    assert.deepEqual(problems, []);
  });

  it('resigning ends the game for both, and nothing more can be played', async () => {
    const { seats, problems } = await match(await member('Black'), await member('White'));
    await act(seats.black, { kind: 'play', color: 'black', point: pointFromName(9, 'E5') });
    // Resigning works even while it is the other player's turn.
    await act(seats.black, { kind: 'resign', color: 'black' });
    const w = ready(await seats.white.refresh());
    assert.deepEqual(w.row.result, { winner: 'white', reason: 'resignation' });
    assert.equal(w.turn, 'over');
    assert.deepEqual(await seats.white.act({ kind: 'play', color: 'white', point: 0 }), {
      ok: false,
      problem: { kind: 'illegal', reason: 'gameOver' },
    });
    assert.deepEqual(problems, []);
  });
});

describe('real life', () => {
  it('leaving the game and coming back: the lobby lists it and the whole history loads', async () => {
    const black = await member('Black');
    const white = await member('White');
    const { id, seats } = await match(black, white);
    for (const [color, name] of [
      ['black', 'E5'],
      ['white', 'C3'],
      ['black', 'D4'],
    ] as const)
      await act(seats[color], { kind: 'play', color, point: pointFromName(9, name) });

    // White closes the game and opens it later from the lobby, on a fresh screen.
    const lobby = new Lobby(white.api);
    await lobby.refresh();
    assert.equal(await lobby.open(id), id);
    const back = new MatchSync(white.api, id, white.id, noProblem);
    const view = ready(await back.refresh());
    assert.equal(view.state.events.length, 3);
    assert.equal(view.turn, 'yours');
    await act(back, { kind: 'play', color: 'white', point: pointFromName(9, 'F4') });
    assert.equal(ready(await seats.black.refresh()).turn, 'yours');
  });

  it('when both phones tap at once, one wins, the other is told and both still show the same game', async () => {
    const { seats, problems } = await match(await member('Black'), await member('White'));
    await act(seats.black, { kind: 'pass', color: 'black' });
    await act(seats.white, { kind: 'pass', color: 'white' });
    await seats.black.refresh();
    await seats.white.refresh();
    const results = await Promise.all([
      seats.black.act({ kind: 'accept', color: 'black' }),
      seats.white.act({ kind: 'resume', color: 'white' }),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    assert.deepEqual(
      results.find((r) => !r.ok),
      { ok: false, problem: { kind: 'stale' } },
    );
    const [b, w] = [ready(await seats.black.refresh()), ready(await seats.white.refresh())];
    assert.equal(b.state.head, w.state.head);
    assert.deepEqual(problems, []);
  });

  it('another family member can watch a game but not play in it', async () => {
    const { id, seats } = await match(await member('Black'), await member('White'));
    await act(seats.black, { kind: 'play', color: 'black', point: pointFromName(9, 'E5') });
    const visitor = await member('Visitor');
    const watch = new MatchSync(visitor.api, id, visitor.id, noProblem);
    const view = ready(await watch.refresh());
    assert.equal(view.you, null);
    assert.equal(view.row.move_count, 1);
    const r = await watch.act({ kind: 'play', color: 'white', point: pointFromName(9, 'C3') });
    assert.equal(!r.ok && r.problem.kind === 'rejected' && r.problem.error.code, 'not_your_game');
    assert.equal(ready(await seats.white.refresh()).turn, 'yours');
  });
});
