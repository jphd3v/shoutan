/**
 * Whose games the phone keeps, and how its list meets the account's history on the server. Pure:
 * `HistorySync` does the talking and the storing.
 *
 * The phone holds one identity's games. A game played signed out has no owner until an account
 * that is in the family claims it; a game of another account stays on the phone, unlisted, until
 * the server has it, and then leaves.
 */
import { FinishedGame, instant, isNewer, keepUnknown, NewerRecord, onlineGameOf, readFinished } from '../go/finished';
import { MAX_RATING, MIN_RATING } from '../go/rating';
import type { KeptGame } from '../ui/prefs';

/** The account a kept game belongs to, or undefined for a game played signed out. */
export function ownerOf(g: FinishedGame | NewerRecord): string | undefined {
  if (!isNewer(g)) return g.meta.player;
  const meta = g.newer.meta;
  const player = meta && typeof meta === 'object' && 'player' in meta ? meta.player : undefined;
  return typeof player === 'string' ? player : undefined;
}

const newestFirst = (a: KeptGame, b: KeptGame) => b.game.endedAt.localeCompare(a.game.endedAt);

/** Games played signed out become `player`'s, to be sent. A newer app's record is left as it is. */
export function claim(kept: readonly KeptGame[], player: string): KeptGame[] {
  return kept.map((k) =>
    isNewer(k.game) || ownerOf(k.game) ? k : { game: { ...k.game, meta: { ...k.game.meta, player } }, uploaded: false },
  );
}

/**
 * The phone's games once `account` signs in after `before`: another account's games the server
 * already has leave the phone; theirs still to send stay, unlisted, until they sign in again.
 */
export function switchTo(kept: readonly KeptGame[], account: string, before: string | null): KeptGame[] {
  if (before === account) return [...kept];
  return kept.filter((k) => {
    const owner = ownerOf(k.game);
    return !owner || owner === account || !k.uploaded;
  });
}

/** The games listed for the player whose games the phone holds (`holder`, the last account signed in). */
export function listed(kept: readonly KeptGame[], holder: string | null): KeptGame[] {
  return kept.filter((k) => {
    const owner = ownerOf(k.game);
    return !owner || !holder || owner === holder;
  });
}

/** The games `owner` still has to send, oldest first. */
export function toSend(kept: readonly KeptGame[], owner: string): FinishedGame[] {
  return kept
    .filter((k) => !k.uploaded && !k.refused && ownerOf(k.game) === owner)
    .map((k) => k.game)
    .filter((g): g is FinishedGame => !isNewer(g))
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
}

/**
 * The phone's games with records read back from the server. A game the phone has not sent yet
 * stays as the phone has it (it goes up next), except an online game the server keeps under
 * another id: the server's record is the one that counts. Otherwise the server's record wins.
 */
export function merge(kept: readonly KeptGame[], records: readonly unknown[]): KeptGame[] {
  let next = [...kept];
  for (const r of records) {
    const theirs = readFinished(r);
    if (!theirs) continue;
    const online = onlineGameOf(theirs);
    const at = next.findIndex(({ game }) => game.id === theirs.id || (!!online && onlineGameOf(game) === online));
    const mine = at >= 0 ? next[at] : null;
    if (mine && mine.game.id === theirs.id && !mine.uploaded && !mine.refused) continue;
    const game = mine && !isNewer(mine.game) && !isNewer(theirs) && mine.game.id === theirs.id ? keepUnknown(mine.game, theirs) : theirs;
    const kept: KeptGame = { game, uploaded: true };
    next = mine ? next.map((k, i) => (i === at ? kept : k)) : [...next, kept];
  }
  return next.sort(newestFirst);
}

/** The rating the server works out for a player, as their phone sees it. */
export interface ServerRating {
  rating: number;
  rated_games: number;
  rating_since: string;
}

/**
 * The player's rating: the server's, moved by the rated games this phone has not sent yet (and
 * that count since the level was chosen).
 */
export function ratingWithUnsent(server: ServerRating, kept: readonly KeptGame[], owner: string): { rating: number; games: number } {
  const since = instant(server.rating_since) ?? -Infinity;
  let rating = server.rating;
  let games = server.rated_games;
  for (const g of toSend(kept, owner)) {
    if (!g.meta.rating || instant(g.endedAt)! < since) continue;
    rating += g.meta.rating.after - g.meta.rating.before;
    games += 1;
  }
  return { rating: Math.min(MAX_RATING, Math.max(MIN_RATING, rating)), games };
}
