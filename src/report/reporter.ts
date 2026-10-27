/**
 * Collects crashes, errors and player feedback in a queue that is saved on every
 * change (synchronously, so a fatal crash is not lost) and sent when the phone is
 * online. Knows nothing about the network: `flush` takes the function that sends.
 */

export type ReportKind = 'crash' | 'error' | 'bug' | 'idea';

export interface QueuedReport {
  /** Local ownership only; never included in the server payload. */
  owner?: string | null;
  kind: ReportKind;
  message: string;
  details: Record<string, unknown>;
  fingerprint: string;
  occurrences: number;
  app_version?: string;
  player_name?: string;
}

export interface ReportContext {
  app_version?: string;
  player_name?: string;
  [detail: string]: unknown;
}

export interface SyncStore {
  get(): string | null;
  set(value: string): void;
}

export const MAX_QUEUED = 50;
const MAX_STEPS = 30;
const MAX_STACK = 4000;

/** Groups the same error across builds: frames are kept, line and column numbers dropped. */
export function fingerprint(kind: string, message: string, stack = ''): string {
  const frames = stack
    .split('\n')
    .slice(0, 5)
    .map((l) => l.replace(/:\d+(:\d+)?/g, '').trim())
    .join('|');
  // FNV-1a: small, stable, good enough to group a few hundred distinct errors.
  let h = 0x811c9dc5;
  for (const ch of `${kind}|${message}|${frames}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack?.slice(0, MAX_STACK) };
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

export class Reporter {
  private owner: string | null = null;
  private queue: QueuedReport[];
  private steps: string[] = [];
  private sending: Promise<boolean> | null = null;
  private inFlight: QueuedReport[] = [];

  constructor(
    private readonly store: SyncStore,
    private readonly context: () => ReportContext,
    private readonly now: () => number = Date.now,
  ) {
    this.queue = this.load();
  }

  setOwner(owner: string | null) {
    if (owner !== this.owner) this.steps = [];
    this.owner = owner;
  }

  /** Remembers a recent player action, to show what led up to an error. */
  breadcrumb(step: string) {
    this.steps.push(step);
    if (this.steps.length > MAX_STEPS) this.steps.shift();
  }

  captureError(error: unknown, kind: 'crash' | 'error', where?: string) {
    const { message, stack } = describe(error);
    const fp = fingerprint(kind, message, stack);
    const existing = this.queue.find((r) => r.owner === this.owner && r.fingerprint === fp && !this.inFlight.includes(r));
    if (existing) {
      existing.occurrences++;
      existing.details = { ...existing.details, last_seen: this.now() };
      this.save();
      return;
    }
    this.add(kind, message.slice(0, 4000), { stack, where }, fp);
  }

  feedback(kind: 'bug' | 'idea', text: string) {
    this.add(kind, text.slice(0, 4000), {}, fingerprint(kind, text, String(this.now())));
  }

  queued(): readonly QueuedReport[] {
    return this.queue;
  }

  /** Sends the queue. Returns false, keeping the reports, when sending fails. */
  async flush(send: (reports: QueuedReport[]) => Promise<void>, owner: string | null = this.owner): Promise<boolean> {
    if (this.sending) {
      if (!(await this.sending)) return false;
      return this.flush(send, owner);
    }
    const batch = this.queue.filter((r) => (r.owner ?? null) === owner);
    if (!batch.length) return true;
    this.inFlight = batch;
    this.sending = this.deliver(send, batch);
    try {
      return await this.sending;
    } finally {
      this.sending = null;
      this.inFlight = [];
    }
  }

  private async deliver(send: (reports: QueuedReport[]) => Promise<void>, batch: QueuedReport[]): Promise<boolean> {
    try {
      await send(batch);
    } catch {
      return false;
    }
    this.queue = this.queue.filter((r) => !batch.includes(r));
    this.save();
    return true;
  }

  private add(kind: ReportKind, message: string, details: Record<string, unknown>, fp: string) {
    const { app_version, player_name, ...rest } = this.context();
    this.queue.push({
      owner: this.owner,
      kind,
      message: message || '(empty)',
      details: { ...rest, ...details, steps: this.steps.slice(), at: this.now() },
      fingerprint: fp,
      occurrences: 1,
      app_version,
      player_name,
    });
    if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
    this.save();
  }

  private load(): QueuedReport[] {
    try {
      const parsed: unknown = JSON.parse(this.store.get() ?? '[]');
      return Array.isArray(parsed) ? (parsed as QueuedReport[]) : [];
    } catch {
      return [];
    }
  }

  private save() {
    try {
      this.store.set(JSON.stringify(this.queue));
    } catch {
      // Storage full or unavailable: keep the reports in memory and send them this session.
    }
  }
}
