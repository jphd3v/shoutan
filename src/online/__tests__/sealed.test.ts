import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameEvent, GameMeta, replay, RULES_VERSION, seal, SealedEvent, startOnline, summary, Summary } from '../log';

/**
 * Online games as the app seals them, frozen as files. Every later app must keep replaying them to
 * the same hashes and result; a change that breaks one needs a new rules version instead (AGENTS.md).
 * Add a game here when a release changes how events are sealed or a rules version is added.
 */
interface Sealed {
  about: string;
  meta: GameMeta;
  events: SealedEvent[];
  head: string;
  summary: Summary;
}

const dir = join(__dirname, 'sealed');
const games = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8')) as Sealed] as const);

describe('online games sealed by earlier versions', () => {
  it('covers this app’s rules version', () => {
    expect(games.map(([, g]) => g.meta.rulesVersion)).toContain(RULES_VERSION);
  });

  it.each(games)('%s replays to the same head and result', (_, g) => {
    const r = replay(g.meta, g.events);
    expect(r.ok).toBe(true);
    expect(r.state.head).toBe(g.head);
    expect(summary(r.state)).toEqual(g.summary);
  });

  it.each(games)('%s seals the same events again', (_, g) => {
    let s = startOnline(g.meta);
    for (const sealed of g.events) {
      const action = Object.fromEntries(Object.entries(sealed).filter(([k]) => k !== 'prev' && k !== 'hash')) as GameEvent;
      const r = seal(s, action);
      if (!r.ok) throw new Error(`${action.kind} refused: ${r.reason}`);
      expect(r.event).toEqual(g.events[s.events.length]);
      s = r.state;
    }
  });
});
