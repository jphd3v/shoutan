/** Player choices remembered on the phone. */
import 'expo-sqlite/localStorage/install';
import { FinishedGame, instant, isNewer, keepUnknown, NewerRecord, onlineGameOf, readFinished, sameResult } from '../go/finished';
import { Level, LEVELS, startingRating } from '../go/rating';
import { GameMeta, restoreGame, SavedGame, savedMeta } from '../go/saved';
import type { Session } from '../go/session';
import { Language, LANGUAGES } from './i18n';
import { isAvatar } from './avatars';

const TEACHING_KEY = 'go.teaching';
const LIBERTIES_KEY = 'go.liberties';
const GROUPS_KEY = 'go.groups';
const STAR_POINTS_KEY = 'go.starPoints';
const COORDINATES_KEY = 'go.coordinates';
const COUNT_STEPS_KEY = 'go.countSteps';
const ESTIMATE_KEY = 'go.scoreEstimate';
const CONFIRM_KEY = 'go.confirmMoves';
const TERRITORY_KEY = 'go.territory';
const LIKELY_KEY = 'go.likelyAreas';
const LANGUAGE_KEY = 'go.language';
const PROFILE_KEY = 'go.profile';
const RANKS_KEY = 'go.showRanks';
const START_PENDING_KEY = 'go.choicesToStart';
const RATED_KEY = 'go.ratedGames';
const GAME_KEY = 'go.currentGame';
const ONLINE_GAME_KEY = 'go.onlineGame';
const FINISHED_KEY = 'go.finishedGames';
const HOLDER_KEY = 'go.historyOwner';
const CURSOR_KEY = 'go.historyCursor';

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'on';
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // Not remembered, but still applies for this session.
  }
}

/** The Coach: the network's strongest moves, outlines and the last move's cost, notes on ko and playing into atari, and hold-to-see liberties. Off unless turned on. */
export const loadTeaching = () => loadFlag(TEACHING_KEY, false);
export const saveTeaching = (on: boolean) => saveFlag(TEACHING_KEY, on);

/** Dots on every liberty on the board. Off unless turned on. */
export const loadShowLiberties = () => loadFlag(LIBERTIES_KEY, false);
export const saveShowLiberties = (on: boolean) => saveFlag(LIBERTIES_KEY, on);

/** Neighbouring stones of one colour joined into one shape, so groups show at a glance. Off unless turned on. */
export const loadShowGroups = () => loadFlag(GROUPS_KEY, false);
export const saveShowGroups = (on: boolean) => saveFlag(GROUPS_KEY, on);

/** The board's star points (the traditional fixed dots). Shown unless turned off. */
export const loadStarPoints = () => loadFlag(STAR_POINTS_KEY, true);
export const saveStarPoints = (on: boolean) => saveFlag(STAR_POINTS_KEY, on);

/** Coordinates on or off, chosen per board size; a size with no choice yet uses its default. */
export function loadCoordinates(): Partial<Record<number, boolean>> {
  try {
    const x = JSON.parse(localStorage.getItem(COORDINATES_KEY) ?? '{}') as unknown;
    if (!x || typeof x !== 'object') return {};
    return Object.fromEntries(Object.entries(x).filter(([, v]) => typeof v === 'boolean'));
  } catch {
    return {};
  }
}

export function saveCoordinates(bySize: Partial<Record<number, boolean>>) {
  try {
    localStorage.setItem(COORDINATES_KEY, JSON.stringify(bySize));
  } catch {
    // Not remembered, but still applies for this session.
  }
}

/** A preview tap before each move, then a confirming tap; on unless turned off. Off: a tap plays at once. */
export const loadConfirmMoves = () => loadFlag(CONFIRM_KEY, true);
export const saveConfirmMoves = (on: boolean) => saveFlag(CONFIRM_KEY, on);

/** The count after a game plays step by step; off, the result shows at once and marking shows the score. */
export const loadCountSteps = () => loadFlag(COUNT_STEPS_KEY, true);
export const saveCountSteps = (on: boolean) => saveFlag(COUNT_STEPS_KEY, on);

/** The score each player seems headed for, on their card while the game is played. Off unless turned on. */
export const loadScoreEstimate = () => loadFlag(ESTIMATE_KEY, false);
export const saveScoreEstimate = (on: boolean) => saveFlag(ESTIMATE_KEY, on);

/** Squares on the territory that has formed while the game is played. Off unless turned on. */
export const loadShowTerritory = () => loadFlag(TERRITORY_KEY, false);
export const saveShowTerritory = (on: boolean) => saveFlag(TERRITORY_KEY, on);

/** Fainter squares where the score estimate expects a player to end up, beyond the territory already formed. Off unless turned on. */
export const loadLikelyAreas = () => loadFlag(LIKELY_KEY, false);
export const saveLikelyAreas = (on: boolean) => saveFlag(LIKELY_KEY, on);

/**
 * Forgets the Guide and display choices, so a newly welcomed player starts from the defaults even
 * when the phone kept choices from an earlier install. The language stays: the welcome offers it.
 */
export function forgetChoices() {
  for (const key of [
    TEACHING_KEY,
    LIBERTIES_KEY,
    GROUPS_KEY,
    STAR_POINTS_KEY,
    COORDINATES_KEY,
    COUNT_STEPS_KEY,
    ESTIMATE_KEY,
    CONFIRM_KEY,
    TERRITORY_KEY,
    LIKELY_KEY,
    RANKS_KEY,
  ]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Still reset for this session.
    }
  }
}

/** The language chosen in Options, or null to follow the phone. */
export function loadLanguage(): Language | null {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    return LANGUAGES.find((l) => l.value === v)?.value ?? null;
  } catch {
    return null;
  }
}
export function saveLanguage(l: Language | null) {
  try {
    if (l) localStorage.setItem(LANGUAGE_KEY, l);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {
    // Not remembered, but still applies for this session.
  }
}

/** The player's own level and rating on this phone. */
export interface Profile {
  name?: string;
  /** One of `AVATARS`, shown on the player's card; absent until the player picks one. */
  avatar?: string;
  level: Level;
  rating: number;
  games: number;
  /**
   * When the rating last started again from `level` (UTC, as `toISOString` writes it): the server
   * counts the games since then. Absent until the rating first starts again: all the player's games count.
   */
  ratingSince?: string;
}

/** A new player starts at the bottom of the scale; their rating climbs from there as they win. */
export const newProfile = (level: Level = 'never'): Profile => ({ level, rating: startingRating(level), games: 0 });

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Partial<Profile> | null;
    if (
      p &&
      LEVELS.includes(p.level as Level) &&
      typeof p.rating === 'number' &&
      Number.isFinite(p.rating) &&
      typeof p.games === 'number' &&
      Number.isInteger(p.games)
    ) {
      return {
        level: p.level as Level,
        rating: p.rating,
        games: p.games,
        ...(typeof p.name === 'string' && p.name.trim() ? { name: p.name.trim() } : {}),
        ...(isAvatar(p.avatar) ? { avatar: p.avatar } : {}),
        ...(typeof p.ratingSince === 'string' && instant(p.ratingSince) !== null ? { ratingSince: p.ratingSince } : {}),
      };
    }
  } catch {
    // Unreadable: start again from the default level.
  }
  return newProfile();
}
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Not remembered, but still applies for this session.
  }
}

/** Go ranks such as "12k" beside the names, for experienced players. Off unless turned on. */
export const loadShowRanks = () => loadFlag(RANKS_KEY, false);
export const saveShowRanks = (on: boolean) => saveFlag(RANKS_KEY, on);

/**
 * Family games already counted in this phone's rating, and since when finished games count at
 * all (the first time this asks), so games that ended before ratings existed are not rated.
 */
export function loadRatedGames(): { since: string; ids: string[] } {
  try {
    const v = JSON.parse(localStorage.getItem(RATED_KEY) ?? 'null') as { since?: unknown; ids?: unknown } | null;
    if (v && typeof v.since === 'string' && Array.isArray(v.ids))
      return { since: v.since, ids: v.ids.filter((x) => typeof x === 'string') };
  } catch {
    // Unreadable: count from now on.
  }
  const fresh = { since: new Date().toISOString(), ids: [] };
  saveRatedGames(fresh);
  return fresh;
}
export function saveRatedGames(v: { since: string; ids: string[] }) {
  try {
    localStorage.setItem(RATED_KEY, JSON.stringify({ since: v.since, ids: v.ids.slice(-200) }));
  } catch {
    // Not remembered: a game may be rated again after the app restarts.
  }
}

/** The unfinished offline game, replayed from its moves, or null to start a fresh one. */
export function loadGame(): Session | null {
  try {
    return restoreGame(JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null'));
  } catch {
    return null;
  }
}
/** The id and start time the unfinished game was saved with, or null. */
/** The online game last on screen, for the account that opened it, so Continue finds it after a restart. */
export function loadOnlineGame(account: string | undefined): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(ONLINE_GAME_KEY) ?? 'null') as { account?: unknown; id?: unknown } | null;
    return saved && account && saved.account === account && typeof saved.id === 'string' ? saved.id : null;
  } catch {
    return null;
  }
}

export function saveOnlineGame(account: string | undefined, id: string | null) {
  try {
    if (account && id) localStorage.setItem(ONLINE_GAME_KEY, JSON.stringify({ account, id }));
    else localStorage.removeItem(ONLINE_GAME_KEY);
  } catch {
    // Continue offers the game on this phone after a restart instead.
  }
}

export function loadGameMeta(): GameMeta | null {
  try {
    return savedMeta(JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null'));
  } catch {
    return null;
  }
}
/** Saves the game after every move; null forgets it once it is finished or replaced. */
export function saveGame(g: SavedGame | null) {
  try {
    if (g) localStorage.setItem(GAME_KEY, JSON.stringify(g));
    else localStorage.removeItem(GAME_KEY);
  } catch {
    // Not saved: the game is lost if Android stops the app.
  }
}

/** A random id in the UUID format the server keys games by. It only needs to be unique, not secret. */
export function randomId(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = '89ab'[Math.floor(Math.random() * 4)];
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A finished game kept on the phone, and whether the server has it yet. */
export interface KeptGame {
  /** A record from a newer app stays as it was written, and is listed without being replayed. */
  game: FinishedGame | NewerRecord;
  uploaded: boolean;
  /** The server refused this record for good, so it is not sent again. */
  refused?: boolean;
}

/**
 * Finished games on this phone, newest first: the player's whole history once it has come down
 * from the server, and games of another account still to be sent. Records from before the format was fixed (they have
 * no `format`) were experimental and are dropped.
 */
export function loadFinished(key = FINISHED_KEY): KeptGame[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v.flatMap((x: { game?: unknown; uploaded?: unknown; refused?: unknown } | null) => {
      const game = readFinished(x?.game);
      return game ? [{ game, uploaded: x?.uploaded === true, ...(x?.refused === true && { refused: true }) }] : [];
    });
  } catch {
    return [];
  }
}
export function saveFinished(games: readonly KeptGame[]) {
  const kept = games.map((g) => (isNewer(g.game) ? { ...g, game: g.game.newer } : g));
  try {
    localStorage.setItem(FINISHED_KEY, JSON.stringify(kept));
  } catch {
    // Not kept: the games played since the last save are lost if the app is stopped.
  }
}

/**
 * Adds a finished game, or replaces the same game (by id, or the same online game), so a
 * recount after fixing dead stones keeps one record and is sent again. The same result
 * recorded again (e.g. a finished game reopened) leaves the kept record as it is, and so does
 * any game a newer app wrote. A replaced record keeps the fields a newer app added to it.
 */
export function addFinished(game: FinishedGame): KeptGame[] {
  const games = loadFinished();
  const online = game.meta.onlineGame;
  const at = games.findIndex(({ game: g }) => g.id === game.id || (!!online && onlineGameOf(g) === online));
  const old = at >= 0 ? games[at].game : null;
  if (old && (isNewer(old) || sameResult(old, game))) return games;
  const next = old
    ? games.map((g, i) => (i === at ? { game: keepUnknown(old, { ...game, id: old.id }), uploaded: false } : g))
    : [{ game, uploaded: false }, ...games];
  saveFinished(next);
  return next;
}

/** The account whose games the phone holds: the last one signed in to the family, or null. */
export function loadHistoryHolder(): string | null {
  try {
    return localStorage.getItem(HOLDER_KEY);
  } catch {
    return null;
  }
}
export function saveHistoryHolder(account: string) {
  try {
    localStorage.setItem(HOLDER_KEY, account);
  } catch {
    // Asked again next time: the games stay on the phone either way.
  }
}

/** The last record read from the server: when it was kept there, and its id. */
export interface HistoryCursor {
  uploadedAt: string;
  id: string;
}

/** How far the phone has read `account`'s records from the server; null to read them all. */
export function loadHistoryCursor(account: string): HistoryCursor | null {
  try {
    const c = JSON.parse(localStorage.getItem(CURSOR_KEY) ?? 'null') as { account?: unknown; uploadedAt?: unknown; id?: unknown } | null;
    if (c && c.account === account && typeof c.uploadedAt === 'string' && typeof c.id === 'string')
      return { uploadedAt: c.uploadedAt, id: c.id };
  } catch {
    // Unreadable: read everything again, which changes nothing already here.
  }
  return null;
}
export function saveHistoryCursor(account: string, c: HistoryCursor | null) {
  try {
    if (c) localStorage.setItem(CURSOR_KEY, JSON.stringify({ account, ...c }));
    else localStorage.removeItem(CURSOR_KEY);
  } catch {
    // Read again from further back next time.
  }
}

/**
 * Marks a phone whose player signed in with "I have played before": their choices are started from
 * their level once it arrives from the account (`takeStartPending`). Phones welcomed earlier never
 * carry the mark, so their choices are never changed.
 */
export function markStartPending() {
  try {
    localStorage.setItem(START_PENDING_KEY, '1');
  } catch {
    // Then the defaults stay.
  }
}

/** True once for a marked phone, which is unmarked. */
export function takeStartPending(): boolean {
  try {
    const marked = localStorage.getItem(START_PENDING_KEY) === '1';
    localStorage.removeItem(START_PENDING_KEY);
    return marked;
  } catch {
    return false;
  }
}
