import { pointFromName } from '../../go/rules';
import { genesis, RULES_VERSION, SealedEvent, Summary } from '../../online/log';
import { ApiError, ApiErrorCode, EventRow, GameRow } from '../api';
import { IntegrityProblem, MatchBackend, MatchSync } from '../match';

const pt = (name: string) => pointFromName(9, name);
const BLACK = 'player-black';
const WHITE = 'player-white';

/** An in-memory stand-in for the database: numbering, chain head and the summary columns. */
class FakeDb implements MatchBackend {
  row: GameRow = {
    id: 'g1',
    size: 9,
    komi: 7.5,
    black: BLACK,
    white: WHITE,
    created_by: BLACK,
    status: 'playing',
    to_play: 'black',
    move_count: 0,
    result: null,
    rules_version: RULES_VERSION,
    handicap: 0,
    head_hash: null,
    black_accepted: false,
    white_accepted: false,
    dispute: null,
    created_at: '',
    updated_at: '',
  };
  events: EventRow[] = [];
  disputes: { n: number; reason: string }[] = [];
  offline = false;
  /** Disputes don't reach the database, while everything else does. */
  disputesLost = false;
  /** Makes the next addEvent store the event and then fail, like a lost response. */
  loseNextResponse = false;

  async gameRow() {
    if (this.offline) throw new TypeError('Network request failed');
    return { ...this.row };
  }

  async eventsAfter(_id: string, after: number, upTo: number) {
    if (this.offline) throw new TypeError('Network request failed');
    const rows = this.events.filter((e) => e.n > after && e.n <= upTo);
    if (rows.length !== upTo - after) throw new ApiError('out_of_sync', 'gap');
    return rows.map((e) => ({ ...e, event: structuredClone(e.event) }));
  }

  async addEvent(_id: string, n: number, event: SealedEvent, s: Summary) {
    if (this.offline) throw new TypeError('Network request failed');
    if (n !== this.row.move_count + 1) throw new ApiError('out_of_sync', 'out_of_sync');
    if (event.prev !== (this.row.head_hash ?? genesis({ id: 'g1', size: 9, komi: 7.5, rulesVersion: RULES_VERSION, handicap: 0 }))) {
      throw new ApiError('broken_chain', 'broken_chain');
    }
    this.events.push({
      game_id: 'g1',
      n,
      player: event.color === 'black' ? BLACK : WHITE,
      event: structuredClone(event),
      created_at: new Date(Date.UTC(2026, 9, 22, 9, 0, n)).toISOString(),
    });
    const reset = ['play', 'pass', 'mark', 'resume'].includes(event.kind);
    this.row = {
      ...this.row,
      move_count: n,
      status: s.status,
      to_play: s.toPlay,
      result: s.result,
      head_hash: event.hash,
      black_accepted: reset ? false : this.row.black_accepted || (event.kind === 'accept' && event.color === 'black'),
      white_accepted: reset ? false : this.row.white_accepted || (event.kind === 'accept' && event.color === 'white'),
    };
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new TypeError('Network request failed');
    }
  }

  async disputeGame(_id: string, n: number, reason: string) {
    if (this.offline || this.disputesLost) throw new TypeError('Network request failed');
    this.disputes.push({ n, reason });
    this.row = { ...this.row, status: 'disputed', dispute: { n, reason, by: 'x' } };
  }
}

function setup() {
  const db = new FakeDb();
  const problems: IntegrityProblem[] = [];
  const black = new MatchSync(db, 'g1', BLACK, (p) => problems.push(p));
  const white = new MatchSync(db, 'g1', WHITE, (p) => problems.push(p));
  return { db, black, white, problems };
}

async function ready(...syncs: MatchSync[]) {
  for (const s of syncs) expect((await s.refresh()).kind).toBe('ready');
}

describe('MatchSync', () => {
  it('two phones play a whole game through scoring and agree on every step', async () => {
    const { black, white, problems } = setup();
    await ready(black, white);
    expect(await black.act({ kind: 'play', color: 'black', point: pt('E5') })).toEqual({ ok: true });
    await white.refresh();
    expect(await white.act({ kind: 'pass', color: 'white' })).toEqual({ ok: true });
    await black.refresh();
    expect(await black.act({ kind: 'pass', color: 'black' })).toEqual({ ok: true });
    await white.refresh();
    expect(await white.act({ kind: 'accept', color: 'white' })).toEqual({ ok: true });
    await black.refresh();
    expect(await black.act({ kind: 'accept', color: 'black' })).toEqual({ ok: true });
    const end = await white.refresh();
    expect(end.kind).toBe('ready');
    if (end.kind !== 'ready') return;
    expect(end.state.game.result).toMatchObject({ winner: 'black', reason: 'score' });
    expect(end.state.head).toBe(end.row.head_hash);
    expect(problems).toEqual([]);
  });

  it('refuses moves the rules forbid without sending anything', async () => {
    const { db, black } = setup();
    await ready(black);
    expect(await black.act({ kind: 'play', color: 'white', point: pt('E5') })).toEqual({
      ok: false,
      problem: { kind: 'illegal', reason: 'notYourTurn' },
    });
    expect(db.events).toHaveLength(0);
  });

  it('stops the game when a stored move was changed, keeping the last agreed position', async () => {
    const { db, black, white, problems } = setup();
    await ready(black, white);
    await black.act({ kind: 'play', color: 'black', point: pt('E5') });
    await white.refresh();
    await white.act({ kind: 'play', color: 'white', point: pt('C3') });
    (db.events[1].event as { point: number }).point = pt('G7');

    const v = await black.refresh();
    expect(v).toMatchObject({ kind: 'stopped', n: 2, reason: 'hashMismatch' });
    if (v.kind === 'stopped') expect(v.state?.events).toHaveLength(1);
    expect(db.disputes).toEqual([{ n: 2, reason: 'hashMismatch' }]);
    expect(problems).toEqual([expect.objectContaining({ gameId: 'g1', n: 2, reason: 'hashMismatch' })]);

    // The other phone sees the stop through the database and does not report again.
    expect(await white.refresh()).toMatchObject({ kind: 'stopped', reason: 'hashMismatch' });
    expect(problems).toHaveLength(1);
    expect(await white.act({ kind: 'pass', color: 'black' })).toEqual({ ok: false, problem: { kind: 'stopped' } });
  });

  it('a stop the database did not hear about is sent again on the next refresh', async () => {
    const { db, black, white, problems } = setup();
    await ready(black, white);
    await black.act({ kind: 'play', color: 'black', point: pt('E5') });
    await white.refresh();
    await white.act({ kind: 'play', color: 'white', point: pt('C3') });
    (db.events[1].event as { point: number }).point = pt('G7');

    db.disputesLost = true;
    expect(await black.refresh()).toMatchObject({ kind: 'stopped', n: 2 });
    expect(db.row.status).toBe('playing');
    await black.refresh();
    expect(db.disputes).toEqual([]);

    db.disputesLost = false;
    await black.refresh();
    expect(db.disputes).toEqual([{ n: 2, reason: 'hashMismatch' }]);
    expect(await white.refresh()).toMatchObject({ kind: 'stopped' });
    await black.refresh();
    expect(db.disputes).toHaveLength(1);
    expect(problems).toHaveLength(1);
  });

  it('stops on a malformed event', async () => {
    const { db, black, white } = setup();
    await ready(black, white);
    await black.act({ kind: 'play', color: 'black', point: pt('E5') });
    (db.events[0].event as Record<string, unknown>).extra = 'x';
    expect(await white.refresh()).toMatchObject({ kind: 'stopped', n: 1, reason: 'badEvent' });
  });

  it('stops when the stored summary disagrees with the replay', async () => {
    const { db, black, white, problems } = setup();
    await ready(black, white);
    await black.act({ kind: 'resign', color: 'black' });
    db.row.result = { winner: 'black', reason: 'resignation' };
    expect(await white.refresh()).toMatchObject({ kind: 'stopped', reason: 'summaryMismatch' });
    expect(problems[0].detail).toHaveProperty('result');
  });

  it('stops when the stored chain head or acceptances are off', async () => {
    const { db, black, white } = setup();
    await ready(black, white);
    await black.act({ kind: 'play', color: 'black', point: pt('E5') });
    db.row.white_accepted = true;
    expect(await white.refresh()).toMatchObject({ kind: 'stopped', reason: 'summaryMismatch' });
  });

  it('never disputes over network trouble or a gap in the history', async () => {
    const { db, black, white, problems } = setup();
    await ready(black, white);
    await black.act({ kind: 'play', color: 'black', point: pt('E5') });

    db.offline = true;
    expect((await white.refresh()).kind).toBe('ready');
    expect(await white.act({ kind: 'play', color: 'white', point: pt('C3') })).toEqual({
      ok: false,
      problem: { kind: 'illegal', reason: 'notYourTurn' },
    });
    db.offline = false;

    const saved = db.events.pop()!;
    expect((await white.refresh()).kind).toBe('ready');
    db.events.push(saved);
    const v = await white.refresh();
    expect(v.kind === 'ready' && v.state.events.length).toBe(1);
    expect(problems).toEqual([]);
  });

  it('a move whose response was lost is confirmed by reading it back', async () => {
    const { db, black } = setup();
    await ready(black);
    db.loseNextResponse = true;
    expect(await black.act({ kind: 'play', color: 'black', point: pt('E5') })).toEqual({ ok: false, problem: { kind: 'offline' } });
    const v = black.view();
    expect(v.kind === 'ready' && v.state.events.length).toBe(1);
    expect(await black.act({ kind: 'play', color: 'black', point: pt('D4') })).toEqual({
      ok: false,
      problem: { kind: 'illegal', reason: 'notYourTurn' },
    });
  });

  it('a move made from an old view is refused by the database and the phone catches up', async () => {
    const { black, white } = setup();
    await ready(black, white);
    await black.act({ kind: 'pass', color: 'black' });
    // White has not refreshed, so it still thinks it is Black's turn; its own move goes through after catching up.
    expect(await white.act({ kind: 'pass', color: 'black' })).toEqual({ ok: false, problem: { kind: 'stale' } });
    expect(await white.act({ kind: 'play', color: 'white', point: pt('C3') })).toEqual({ ok: true });
  });

  it('shows a game stopped by the other phone', async () => {
    const { db, black } = setup();
    db.row = { ...db.row, status: 'disputed', dispute: { n: 3, reason: 'hashMismatch', by: WHITE } };
    expect(await black.refresh()).toMatchObject({ kind: 'stopped', n: 3, reason: 'hashMismatch' });
  });

  it('does not try to replay a game made with rules this app does not know', async () => {
    const { db, black, problems } = setup();
    db.row.rules_version = RULES_VERSION + 1;
    expect((await black.refresh()).kind).toBe('unsupported');
    expect(problems).toEqual([]);
  });

  it('a first load that fails throws, so the screen can show the error', async () => {
    const { db, black } = setup();
    db.offline = true;
    await expect(black.refresh()).rejects.toThrow('Network request failed');
    db.offline = false;
    expect((await black.refresh()).kind).toBe('ready');
  });

  it('tells each phone its seat and whose turn it is', async () => {
    const { db, black, white } = setup();
    const watcher = new MatchSync(db, 'g1', 'someone-else', () => {});
    expect(await black.refresh()).toMatchObject({ you: 'black', turn: 'yours' });
    expect(await white.refresh()).toMatchObject({ you: 'white', turn: 'theirs' });
    expect(await watcher.refresh()).toMatchObject({ you: null, turn: 'theirs' });
    await black.act({ kind: 'pass', color: 'black' });
    expect(await white.refresh()).toMatchObject({ turn: 'yours' });
    await white.act({ kind: 'pass', color: 'white' });
    expect(await black.refresh()).toMatchObject({ turn: 'scoring' });
    await black.act({ kind: 'resign', color: 'black' });
    expect(await white.refresh()).toMatchObject({ turn: 'over' });
  });

  it('a game still waiting for an opponent is "waiting"', async () => {
    const { db, black } = setup();
    db.row = { ...db.row, status: 'open', white: null };
    expect(await black.refresh()).toMatchObject({ you: 'black', turn: 'waiting' });
  });

  it('reports database refusals in game terms', async () => {
    const { db, black } = setup();
    await ready(black);
    const failWith = (code: ApiErrorCode) => {
      db.addEvent = async () => {
        throw new ApiError(code, code);
      };
    };
    failWith('game_disputed');
    expect(await black.act({ kind: 'pass', color: 'black' })).toEqual({ ok: false, problem: { kind: 'stopped' } });
    failWith('already_accepted');
    expect(await black.act({ kind: 'pass', color: 'black' })).toEqual({ ok: false, problem: { kind: 'stale' } });
    failWith('bad_summary');
    const r = await black.act({ kind: 'pass', color: 'black' });
    expect(r).toMatchObject({ ok: false, problem: { kind: 'rejected' } });
  });
});
