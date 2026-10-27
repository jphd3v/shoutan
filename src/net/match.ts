/**
 * Keeps one online game in sync with the database and verifies everything it reads.
 * Used by the app screen, the end-to-end test opponent and the database tests, so all
 * three exercise the same checks.
 *
 * - Reads the game row, then only the events this phone has not verified yet.
 * - Parses each event strictly and extends the hash chain with the shared rules.
 * - Compares the row's summary (status, side to move, result, acceptances, chain head)
 *   with its own replay.
 * - Any deterministic disagreement stops the game for both players (`dispute_game`)
 *   and is reported. Network failures never do: they leave the state unchanged for the
 *   next refresh.
 */
import type { Color, Result } from '../go/rules';
import { extend, GameEvent, OnlineGame, parseEvent, RefusedReason, RULES_VERSION, seal, startOnline, summary } from '../online/log';
import { ApiError, EventRow, GameRow, GoApi } from './api';

export type MatchBackend = Pick<GoApi, 'gameRow' | 'eventsAfter' | 'addEvent' | 'disputeGame'>;

export type MatchView =
  | { kind: 'loading' }
  /**
   * `you` is this phone's colour (null when watching); `turn` says what happens next from that seat.
   * `played` is when the server stored the first and the latest event, null before the first.
   */
  | { kind: 'ready'; row: GameRow; state: OnlineGame; you: Color | null; turn: Turn; played: Played | null }
  /** The game was stopped because the phones' histories disagree. `state` is the last agreed position. */
  | { kind: 'stopped'; row: GameRow; state: OnlineGame | null; n: number; reason: string }
  /** The game was started by a newer app with different rules. */
  | { kind: 'unsupported'; row: GameRow };

export interface Played {
  from: string;
  to: string;
}

export interface IntegrityProblem {
  gameId: string;
  n: number;
  reason: string;
  detail: Record<string, unknown>;
}

export type Turn = 'waiting' | 'yours' | 'theirs' | 'scoring' | 'over';

/** Why an action did not happen, in the game's terms. The view is current again in every case. */
export type ActProblem =
  /** The rules refuse it in the position this phone shows. */
  | { kind: 'illegal'; reason: RefusedReason }
  /** The game moved on before the action arrived (the other phone acted first). */
  | { kind: 'stale' }
  /** The server was not reached; whether the action arrived shows on the board. */
  | { kind: 'offline' }
  /** The game is stopped or not loaded. */
  | { kind: 'stopped' }
  /** The server refused something this app sent: a bug, worth reporting. */
  | { kind: 'rejected'; error: ApiError };

export type ActResult = { ok: true } | { ok: false; problem: ActProblem };

/** Whether this app plays the game: one a newer app created under later rules is shown as needing an update. */
export const playable = (row: Pick<GameRow, 'rules_version'>) => row.rules_version === RULES_VERSION;

/** Database refusals that only mean "another event got there first". */
const STALE = ['out_of_sync', 'broken_chain', 'not_your_turn', 'not_scoring', 'already_accepted', 'game_not_running'];

function problemFrom(e: unknown): ActProblem {
  if (!(e instanceof ApiError) || e.code === 'network') return { kind: 'offline' };
  if (e.code === 'game_disputed') return { kind: 'stopped' };
  if (STALE.includes(e.code)) return { kind: 'stale' };
  return { kind: 'rejected', error: e };
}

const sameResult = (a: Result | null, b: Result | null) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
function normalize(r: Result | null) {
  if (!r) return null;
  return r.reason === 'score'
    ? { winner: r.winner, reason: r.reason, margin: Number(r.margin), black: Number(r.black), white: Number(r.white) }
    : { winner: r.winner, reason: r.reason };
}

export class MatchSync {
  private current: MatchView = { kind: 'loading' };
  private state: OnlineGame | null = null;
  private played: Played | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** A stop this phone found that has not reached the database yet, so the other phone still plays on. */
  private unsentDispute: { n: number; reason: string } | null = null;

  constructor(
    private readonly api: MatchBackend,
    private readonly gameId: string,
    /** This phone's player id, to tell its seat. */
    private readonly me: string,
    private readonly onProblem: (p: IntegrityProblem) => void,
  ) {}

  view(): MatchView {
    return this.current;
  }

  /** Fetches and verifies anything new. Calls are serialized, so polling and moves never interleave. */
  refresh(): Promise<MatchView> {
    return this.serial(() => this.load());
  }

  /** Seals an action made on this phone, sends it, and confirms it by reading it back. */
  act(action: GameEvent): Promise<ActResult> {
    return this.serial(async () => {
      if (this.current.kind !== 'ready' || !this.state) return { ok: false, problem: { kind: 'stopped' } };
      const sealed = seal(this.state, action);
      if (!sealed.ok) return { ok: false, problem: { kind: 'illegal', reason: sealed.reason } };
      try {
        await this.api.addEvent(this.gameId, sealed.state.events.length, sealed.event, summary(sealed.state));
      } catch (e) {
        // Whether or not it arrived, the chain tells: if it did, the next load verifies our own event.
        await this.load().catch(() => this.current);
        return { ok: false, problem: problemFrom(e) };
      }
      await this.load();
      return { ok: true };
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  private async load(): Promise<MatchView> {
    let row: GameRow;
    let rows: EventRow[];
    try {
      row = await this.api.gameRow(this.gameId);
      if (!playable(row)) return (this.current = { kind: 'unsupported', row });
      const meta = {
        id: row.id,
        size: row.size,
        komi: Number(row.komi),
        rulesVersion: row.rules_version,
        handicap: row.handicap,
      };
      if (!this.state) this.state = startOnline(meta);
      // Events are never removed, so a shorter history means a stale read; try again later.
      if (row.move_count < this.state.events.length) return this.current;
      rows = await this.api.eventsAfter(this.gameId, this.state.events.length, row.move_count);
    } catch (e) {
      if (this.current.kind === 'loading') throw e;
      return this.current;
    }

    if (this.current.kind === 'stopped') {
      if (this.unsentDispute && (row.status === 'playing' || row.status === 'scoring')) await this.sendDispute(this.unsentDispute);
      return (this.current = { ...this.current, row });
    }

    for (const r of rows) {
      const ev = parseEvent(r.event, row.size);
      if (!ev) return this.stop(row, r.n, 'badEvent', { event: r.event });
      const next = extend(this.state, [ev]);
      if (!next.ok) return this.stop(row, r.n, next.reason, { event: r.event });
      this.state = next.state;
      this.played = { from: this.played?.from ?? r.created_at, to: r.created_at };
    }

    if (row.status === 'disputed') {
      const d = row.dispute;
      return (this.current = { kind: 'stopped', row, state: this.state, n: d?.n ?? row.move_count, reason: d?.reason ?? 'disputed' });
    }
    const mismatch = this.summaryMismatch(row, this.state);
    if (mismatch) return this.stop(row, row.move_count, 'summaryMismatch', mismatch);
    const you: Color | null = row.black === this.me ? 'black' : row.white === this.me ? 'white' : null;
    return (this.current = { kind: 'ready', row, state: this.state, you, turn: turnFor(row, this.state, you), played: this.played });
  }

  /** Compares what the database says about the game with this phone's replay. */
  private summaryMismatch(row: GameRow, s: OnlineGame): Record<string, unknown> | null {
    if (row.status === 'open') return s.events.length === 0 ? null : { status: row.status, events: s.events.length };
    const mine = summary(s);
    const expectedHead = s.events.length ? s.head : null;
    const differences: Record<string, unknown> = {};
    if (row.status !== mine.status) differences.status = [row.status, mine.status];
    if (row.to_play !== mine.toPlay) differences.to_play = [row.to_play, mine.toPlay];
    if (!sameResult(row.result, mine.result)) differences.result = [row.result, mine.result];
    if (row.head_hash !== expectedHead) differences.head_hash = [row.head_hash, expectedHead];
    if (row.black_accepted !== s.accepted.black || row.white_accepted !== s.accepted.white) {
      differences.accepted = [
        [row.black_accepted, row.white_accepted],
        [s.accepted.black, s.accepted.white],
      ];
    }
    return Object.keys(differences).length ? differences : null;
  }

  private async stop(row: GameRow, n: number, reason: string, detail: Record<string, unknown>): Promise<MatchView> {
    this.current = { kind: 'stopped', row, state: this.state, n, reason };
    this.onProblem({ gameId: this.gameId, n, reason, detail: { ...detail, rules_version: row.rules_version } });
    await this.sendDispute({ n, reason });
    return this.current;
  }

  /** The game stays stopped on this phone either way; one the network kept from the database is sent again on a later refresh. */
  private async sendDispute(d: { n: number; reason: string }) {
    try {
      await this.api.disputeGame(this.gameId, d.n, d.reason);
      this.unsentDispute = null;
    } catch (e) {
      this.unsentDispute = problemFrom(e).kind === 'offline' ? d : null;
    }
  }
}

function turnFor(row: GameRow, s: OnlineGame, you: Color | null): Turn {
  if (row.status === 'open') return 'waiting';
  if (s.game.phase === 'over') return 'over';
  if (s.game.phase === 'scoring') return 'scoring';
  return s.game.toPlay === you ? 'yours' : 'theirs';
}
