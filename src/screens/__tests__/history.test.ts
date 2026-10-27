import { FinishedGame, NewerRecord, readFinished } from '../../go/finished';
import type { KeptGame } from '../../ui/prefs';
import { readable, newer } from '../../go/__tests__/records';
import { claim, listed, merge, ownerOf, ratingWithUnsent, switchTo, toSend } from '../history';

const golden = (file: string) => readFinished(readable().find(([f]) => f === `v1/${file}.json`)![1]) as FinishedGame;

const ids = new Map<string, string>();
/** A record id for a name, the same each time. */
const uid = (name: string) => {
  if (!ids.has(name)) ids.set(name, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
  return ids.get(name)!;
};
const names = (list: readonly { id: string }[]) => list.map((g) => [...ids].find(([, id]) => id === g.id)?.[0] ?? g.id);

/** A record of `file` with its own id, owner and end time. */
function game(file: string, name: string, player: string | undefined, at: string): FinishedGame {
  const r = golden(file);
  const meta = { ...r.meta, player };
  if (!player) delete meta.player;
  const time = new Date(at).toISOString();
  return { ...r, id: uid(name), startedAt: time, endedAt: time, meta };
}

const later = () => readFinished(newer()[0][1]) as NewerRecord;

const kept = (game: FinishedGame | NewerRecord, uploaded = false, refused = false): KeptGame => ({
  game,
  uploaded,
  ...(refused ? { refused } : {}),
});

const A = 'aaaaaaaa-0000-4000-8000-000000000000';
const B = 'bbbbbbbb-0000-4000-8000-000000000000';

describe('whose games the phone holds', () => {
  it('games played signed out become the family member’s, to be sent again', () => {
    const list = [
      kept(game('bot-9-scored', '1', undefined, '2026-10-01T10:00:00Z'), true),
      kept(game('bot-9-scored', '2', B, '2026-10-02T10:00:00Z'), true),
      kept(later()),
    ];
    const next = claim(list, A);
    expect(ownerOf(next[0].game)).toBe(A);
    expect(next[0].uploaded).toBe(false);
    expect(next[1]).toBe(list[1]);
    expect(next[2]).toBe(list[2]);
  });

  it('another account signing in sends away the games the server has and hides the unsent ones', () => {
    const list = [
      kept(game('bot-9-scored', 'a-sent', A, '2026-10-01T10:00:00Z'), true),
      kept(game('bot-9-scored', 'a-unsent', A, '2026-10-02T10:00:00Z')),
      kept(game('bot-9-scored', 'nobody', undefined, '2026-10-03T10:00:00Z')),
    ];
    const next = switchTo(list, B, A);
    expect(names(next.map((k) => k.game))).toEqual(['a-unsent', 'nobody']);
    expect(names(listed(next, B).map((k) => k.game))).toEqual(['nobody']);
    expect(names(listed(next, A).map((k) => k.game))).toEqual(['a-unsent', 'nobody']);
    expect(listed(next, null)).toHaveLength(2);
    expect(switchTo(list, A, A)).toEqual(list);
  });

  it('sends the owner’s unsent games oldest first, never a refused one or another owner’s', () => {
    const list = [
      kept(game('bot-9-scored', 'new', A, '2026-10-03T10:00:00Z')),
      kept(game('bot-9-scored', 'old', A, '2026-10-01T10:00:00Z')),
      kept(game('bot-9-scored', 'sent', A, '2026-10-02T10:00:00Z'), true),
      kept(game('bot-9-scored', 'refused', A, '2026-10-02T11:00:00Z'), false, true),
      kept(game('bot-9-scored', 'theirs', B, '2026-10-02T12:00:00Z')),
      kept(later()),
    ];
    expect(names(toSend(list, A))).toEqual(['old', 'new']);
  });
});

describe('the phone’s list meets the server’s', () => {
  it('adds games from the account’s other phones, newest first', () => {
    const mine = [kept(game('bot-9-scored', 'here', A, '2026-10-02T10:00:00Z'), true)];
    const there = game('bot-9-handicap-2-scored', 'there', A, '2026-10-03T10:00:00Z');
    const next = merge(mine, [there, { not: 'a record' }]);
    expect(names(next.map((k) => k.game))).toEqual(['there', 'here']);
    expect(next.every((k) => k.uploaded)).toBe(true);
  });

  it('keeps a recount the phone has not sent yet, and takes the server’s over one it has', () => {
    const recount = game('bot-9-scored', 'same', A, '2026-10-02T11:00:00Z');
    const server = game('bot-9-scored', 'same', A, '2026-10-02T10:00:00Z');
    expect(merge([kept(recount)], [server])[0]).toEqual(kept(recount));
    expect(merge([kept(recount, true)], [server])[0]).toEqual(kept(server, true));
  });

  it('keeps one online game the server holds under another id', () => {
    const here = game('online-19-scored', 'here', A, '2026-10-02T10:00:00Z');
    const there = game('online-19-scored', 'there', A, '2026-10-02T10:00:01Z');
    const next = merge([kept(here)], [there]);
    expect(next).toEqual([kept(there, true)]);
  });
});

describe('the rating the phone shows', () => {
  const server = { rating: 1000, rated_games: 4, rating_since: '2026-10-02T00:00:00.000+00:00' };

  it('is the server’s, moved by the rated games not sent yet since the level was chosen', () => {
    const list = [
      kept(game('bot-9-scored', 'unsent', A, '2026-10-03T10:00:00Z')), // +62
      kept(game('bot-9-handicap-2-scored', 'sent', A, '2026-10-03T11:00:00Z'), true),
      kept(game('bot-9-scored', 'before', A, '2026-10-01T10:00:00Z')),
      kept(game('bot-9-scored', 'theirs', B, '2026-10-03T10:00:00Z')),
    ];
    expect(ratingWithUnsent(server, list, A)).toEqual({ rating: 1062, games: 5 });
    expect(ratingWithUnsent({ ...server, rating: 2890 }, list, A).rating).toBe(2900);
  });
});
