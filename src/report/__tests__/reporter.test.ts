import { fingerprint, MAX_QUEUED, QueuedReport, Reporter } from '../reporter';

function memoryStore() {
  let value: string | null = null;
  return {
    get: () => value,
    set: (v: string) => {
      value = v;
    },
  };
}

const context = () => ({ app_version: '1.2.0 (12)', channel: 'dev', player_name: 'John Doe', game: 'B E5' });

function setup() {
  const store = memoryStore();
  let now = 1000;
  const reporter = new Reporter(store, context, () => now++);
  const sent: QueuedReport[][] = [];
  const sink = async (r: QueuedReport[]) => {
    sent.push(r);
  };
  return { store, reporter, sent, sink };
}

function boom(message = 'boom') {
  try {
    throw new TypeError(message);
  } catch (e) {
    return e;
  }
}

describe('Reporter', () => {
  it('captures an error with its stack, recent steps and app context', () => {
    const { reporter } = setup();
    reporter.breadcrumb('tap E5');
    reporter.breadcrumb('pass');
    reporter.captureError(boom(), 'crash');
    const [r] = reporter.queued();
    expect(r).toMatchObject({
      kind: 'crash',
      message: 'TypeError: boom',
      occurrences: 1,
      app_version: '1.2.0 (12)',
      player_name: 'John Doe',
    });
    expect(r.details).toMatchObject({ channel: 'dev', game: 'B E5', steps: ['tap E5', 'pass'] });
    expect(String(r.details.stack)).toContain('boom');
  });

  it('merges repeats of the same error into one report with a count', () => {
    const { reporter } = setup();
    for (let i = 0; i < 3; i++) reporter.captureError(boom(), 'error');
    reporter.captureError(boom('other'), 'error');
    expect(reporter.queued().map((r) => [r.message, r.occurrences])).toEqual([
      ['TypeError: boom', 3],
      ['TypeError: other', 1],
    ]);
  });

  it('turns thrown non-errors into readable messages', () => {
    const { reporter } = setup();
    reporter.captureError('just a string', 'error');
    reporter.captureError({ code: 42 }, 'error');
    reporter.captureError(undefined, 'error');
    expect(reporter.queued().map((r) => r.message)).toEqual(['just a string', '{"code":42}', 'undefined']);
  });

  it('keeps feedback separate even when the text repeats', () => {
    const { reporter } = setup();
    reporter.feedback('bug', 'The bot passed too early');
    reporter.feedback('bug', 'The bot passed too early');
    reporter.feedback('idea', 'Add handicap stones');
    expect(reporter.queued().map((r) => r.kind)).toEqual(['bug', 'bug', 'idea']);
  });

  it('survives a restart: the queue is saved immediately', () => {
    const { store, reporter } = setup();
    reporter.captureError(boom(), 'crash');
    const reborn = new Reporter(store, context, () => 0);
    expect(reborn.queued()).toHaveLength(1);
  });

  it('starts empty when the saved queue is corrupt', () => {
    const store = memoryStore();
    store.set('{not json');
    expect(new Reporter(store, context).queued()).toEqual([]);
  });

  it('sends everything once and clears the queue', async () => {
    const { reporter, sent, sink } = setup();
    reporter.captureError(boom(), 'error');
    reporter.feedback('idea', 'Sounds');
    expect(await reporter.flush(sink)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(2);
    expect(reporter.queued()).toEqual([]);
    expect(await reporter.flush(sink)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('keeps the queue when sending fails, and keeps reports made during a send', async () => {
    const { reporter } = setup();
    reporter.feedback('bug', 'one');
    expect(await reporter.flush(() => Promise.reject(new Error('offline')))).toBe(false);
    expect(reporter.queued()).toHaveLength(1);

    const ok = reporter.flush(async () => {
      reporter.feedback('bug', 'two');
    });
    await ok;
    expect(reporter.queued().map((r) => r.message)).toEqual(['two']);
  });

  it('drops the oldest reports beyond the cap', () => {
    const { reporter } = setup();
    for (let i = 0; i < MAX_QUEUED + 5; i++) reporter.feedback('bug', `n${i}`);
    const q = reporter.queued();
    expect(q).toHaveLength(MAX_QUEUED);
    expect(q[0].message).toBe('n5');
  });

  it('fingerprints ignore line and column numbers, so a rebuild keeps the grouping', () => {
    const a = fingerprint('error', 'TypeError: x', 'at f (index.bundle:1:100)\nat g (index.bundle:1:200)');
    const b = fingerprint('error', 'TypeError: x', 'at f (index.bundle:1:999)\nat g (index.bundle:1:5)');
    const c = fingerprint('error', 'TypeError: y', 'at f (index.bundle:1:100)');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});

it('serializes overlapping sends and preserves errors repeated during delivery', async () => {
  const { reporter } = setup();
  const error = boom();
  reporter.captureError(error, 'error');
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sink = jest.fn(async () => {
    await pending;
  });
  const first = reporter.flush(sink);
  reporter.captureError(error, 'error');
  const second = reporter.flush(sink);
  expect(sink).toHaveBeenCalledTimes(1);
  release();
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(sink).toHaveBeenCalledTimes(2);
  expect(reporter.queued()).toHaveLength(0);
});

it('keeps reports and breadcrumbs with their account across sign-out and retries', async () => {
  const { reporter, sink, sent, store } = setup();
  reporter.setOwner('alice');
  reporter.breadcrumb('Alice game');
  reporter.feedback('bug', 'Alice report');
  reporter.setOwner(null);
  reporter.feedback('idea', 'Guest report');
  reporter.setOwner('bob');
  reporter.feedback('bug', 'Bob report');
  await reporter.flush(sink, 'bob');
  expect(sent.flat().map((r) => r.message)).toEqual(['Bob report']);
  expect(sent[0][0].details.steps).toEqual([]);
  const restored = new Reporter(store, context);
  await restored.flush(sink, 'alice');
  expect(sent.flat().map((r) => r.message)).toEqual(['Bob report', 'Alice report']);
  expect(restored.queued().map((r) => r.message)).toEqual(['Guest report']);
});
