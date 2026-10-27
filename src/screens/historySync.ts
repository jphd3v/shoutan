/**
 * Keeps the phone's finished games and the account's history on the server the same, for one
 * account in the family. Claims the games played signed out, sends the ones the server lacks,
 * and reads back what changed there (games from the account's other phones). One run at a time;
 * a run asked for during another follows it. Never throws: a phone offline tries again on the
 * next run, and play never waits on it.
 */
import { instant } from '../go/finished';
import type { Level } from '../go/rating';
import { ApiError, GoApi, Player } from '../net/api';
import {
  HistoryCursor,
  KeptGame,
  loadFinished,
  loadHistoryCursor,
  loadHistoryHolder,
  saveFinished,
  saveHistoryCursor,
  saveHistoryHolder,
} from '../ui/prefs';
import { claim, merge, switchTo, toSend } from './history';

export type HistoryBackend = Pick<GoApi, 'me' | 'recordFinishedGame' | 'myRecords' | 'setMyLevel'>;

/** Where the phone keeps its games and how far it has read the server's. */
export interface HistoryStore {
  load(): KeptGame[];
  save(kept: readonly KeptGame[]): void;
  holder(): string | null;
  setHolder(account: string): void;
  cursor(account: string): HistoryCursor | null;
  setCursor(account: string, c: HistoryCursor | null): void;
}

/** The phone's own storage. */
export const phoneHistory: HistoryStore = {
  load: () => loadFinished(),
  save: saveFinished,
  holder: loadHistoryHolder,
  setHolder: saveHistoryHolder,
  cursor: loadHistoryCursor,
  setCursor: saveHistoryCursor,
};

export interface HistoryState {
  kept: readonly KeptGame[];
  /** The account's player as the server had it after the last run: null outside the family, undefined before. */
  me: Player | null | undefined;
  /** The last run finished: `me` counts exactly the games in `kept` that are marked sent. */
  synced: boolean;
}

const PAGE = 100;
const NO_ID = '00000000-0000-0000-0000-000000000000';
/** Read again from this far before the last record read, for a record a slow write kept just before it. */
const OVERLAP_MS = 60_000;

/** The server refused the record for good: sending it again would be refused again. */
const refusedForGood = (e: unknown) => e instanceof ApiError && (e.code === 'bad_game' || e.code === 'not_your_game');

/** A time `toISOString`-style, from one `instant` reads. */
const iso = (ms: number) => new Date(Math.floor(ms)).toISOString();

export class HistorySync {
  private fields: HistoryState;
  private listeners = new Set<(s: HistoryState) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    private readonly api: HistoryBackend,
    private readonly account: string,
    private readonly store: HistoryStore,
    private readonly appVersion: string,
    /** Unexpected failures, for error reports. */
    private readonly onError: (e: unknown) => void = () => {},
  ) {
    this.fields = { kept: store.load(), me: undefined, synced: false };
  }

  state(): HistoryState {
    return this.fields;
  }

  subscribe(listener: (s: HistoryState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The account signed out or another signed in: nothing this one asked for is stored or shown. */
  stop() {
    this.stopped = true;
    this.listeners.clear();
  }

  /** Runs now, or after the run in progress. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = async () => {
      do {
        this.again = false;
        await this.once();
      } while (this.again && !this.stopped);
      this.running = null;
    };
    this.running = run();
    return this.running;
  }

  /**
   * The player chose a level on this phone at `since`; the server's rating starts again from it.
   * Resolves false when the server could not be told, to tell it on a later run.
   */
  async reportLevel(level: Level, since: string): Promise<boolean> {
    try {
      await this.api.setMyLevel(level, since);
    } catch (e) {
      this.unexpected(e);
      return false;
    }
    await this.sync();
    return true;
  }

  private set(next: Partial<HistoryState>) {
    if (this.stopped) return;
    this.fields = { ...this.fields, ...next };
    for (const l of this.listeners) l(this.fields);
  }

  /** Reads the phone's games, changes them and stores them in one step, so a game kept meanwhile is not lost. */
  private update(change: (kept: KeptGame[]) => KeptGame[]) {
    if (this.stopped) return;
    const next = change(this.store.load());
    this.store.save(next);
    this.set({ kept: next, synced: false });
  }

  private unexpected(e: unknown) {
    if (!(e instanceof ApiError) || !['network', 'not_signed_in', 'unavailable'].includes(e.code)) this.onError(e);
  }

  private async once() {
    const account = this.account;
    try {
      const me = await this.api.me();
      if (this.stopped) return;
      if (!me) {
        this.set({ kept: this.store.load(), me: null, synced: true });
        return;
      }
      const before = this.store.holder();
      if (before !== account) {
        this.update((kept) => switchTo(kept, account, before));
        this.store.setCursor(account, null);
        this.store.setHolder(account);
      }
      this.update((kept) => claim(kept, account));
      for (const g of toSend(this.store.load(), account)) {
        // Marked only while the phone still has the record as sent: a recount meanwhile goes up next.
        const sent = JSON.stringify(g);
        const mark = (done: Partial<KeptGame>) =>
          this.update((kept) => kept.map((k) => (k.game.id === g.id && JSON.stringify(k.game) === sent ? { ...k, ...done } : k)));
        try {
          await this.api.recordFinishedGame(g, this.appVersion);
          mark({ uploaded: true });
        } catch (e) {
          if (!refusedForGood(e)) throw e;
          this.onError(e);
          mark({ refused: true });
        }
        if (this.stopped) return;
      }
      await this.download(account);
      if (this.stopped) return;
      const after = await this.api.me();
      if (this.stopped) return;
      this.set({ kept: this.store.load(), me: after, synced: true });
    } catch (e) {
      this.unexpected(e);
    }
  }

  private async download(account: string) {
    const last = this.store.cursor(account);
    const from = last && instant(last.uploadedAt);
    let after: HistoryCursor | null = from ? { uploadedAt: iso(from - OVERLAP_MS), id: NO_ID } : null;
    for (;;) {
      const rows = await this.api.myRecords(after, PAGE);
      if (this.stopped) return;
      this.update((kept) =>
        merge(
          kept,
          rows.map((r) => r.record),
        ),
      );
      const end = rows[rows.length - 1];
      if (end) {
        after = { uploadedAt: end.uploaded_at, id: end.id };
        this.store.setCursor(account, after);
      }
      if (rows.length < PAGE) return;
    }
  }
}
