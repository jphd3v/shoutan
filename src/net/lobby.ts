/**
 * The family lobby: who this phone is, which games it can open or join, and the actions
 * on them. Background refreshes and the player's taps never get in each other's way:
 * - refreshes never mark the lobby busy and never clear the message about a failed action;
 * - a tap during a refresh still happens; one action at a time, the next tap waits for it;
 * - a refresh that started before an action cannot overwrite what the action showed.
 */
import type { Color } from '../go/rules';
import { ApiError, GameRow, GoApi, Player } from './api';

export type LobbyBackend = Pick<
  GoApi,
  | 'me'
  | 'listGames'
  | 'players'
  | 'seenPlayers'
  | 'register'
  | 'rename'
  | 'createGame'
  | 'askToPlay'
  | 'joinGame'
  | 'cancelGame'
  | 'setMyAvatar'
  | 'touchPresence'
>;

/** Why the last action failed. Stays until the next action. */
export type LobbyProblem = 'wrongFamilyCode' | 'nameTaken' | 'gameTaken' | 'tooManyOpenGames' | 'offline' | 'unavailable' | 'failed';

export interface LobbyState {
  /** Undefined until first loaded; null while this phone has not joined the family. */
  me: Player | null | undefined;
  games: readonly GameRow[];
  /** An action is in flight. */
  busy: boolean;
  problem: LobbyProblem | null;
  /** Whether the last refresh reached the server. */
  online: boolean;
  /** The server answered that online play is not set up on it. */
  unavailable: boolean;
  nameOf(playerId: string | null): string | undefined;
  /** A family member's rating as the server works it out from their games, or null. */
  ratingOf(playerId: string | null): number | null;
  /** A family member's avatar as they picked it, or null. */
  avatarOf(playerId: string | null): string | null;
  /** Everything the family knows about a member, or undefined while they are not loaded. */
  playerOf(playerId: string | null): Player | undefined;
  /** The other family members who have had Play online open, the most recent first. */
  people: readonly Player[];
  /** Whether the member had Play online open a moment ago. */
  isOnline(playerId: string): boolean;
  /** The time by the server's clock, as far as this phone knows it. */
  now(): number;
}

/** A phone says it is present every 20 s; a member counts as online for 60 s after that. */
const PRESENCE_EVERY_MS = 20_000;
export const ONLINE_FOR_MS = 60_000;

type Fields = Omit<LobbyState, 'nameOf' | 'ratingOf' | 'avatarOf' | 'playerOf' | 'people' | 'isOnline' | 'now'> & {
  players: readonly Player[];
};

function problemOf(e: unknown): LobbyProblem {
  if (!(e instanceof ApiError) || e.code === 'network') return 'offline';
  if (e.code === 'wrong_family_code') return 'wrongFamilyCode';
  if (e.code === 'name_taken') return 'nameTaken';
  if (e.code === 'game_not_open' || e.code === 'not_invited') return 'gameTaken';
  if (e.code === 'too_many_open_games') return 'tooManyOpenGames';
  if (e.code === 'unavailable') return 'unavailable';
  return 'failed';
}

export class Lobby {
  private fields: Fields = { me: undefined, games: [], players: [], busy: false, problem: null, online: true, unavailable: false };
  private listeners = new Set<(s: LobbyState) => void>();
  private started = 0;
  private presentAt = 0;
  /** The server's clock minus this phone's, learnt when presence is sent. */
  private skew = 0;
  private shown = 0;

  constructor(
    private readonly api: LobbyBackend,
    /** Unexpected failures, for error reports. */
    private readonly onError: (e: unknown) => void = () => {},
  ) {}

  state(): LobbyState {
    const { players, ...rest } = this.fields;
    const find = (id: string | null) => (id === rest.me?.id ? rest.me : players.find((p) => p.id === id));
    return {
      ...rest,
      nameOf: (id) => find(id)?.name,
      ratingOf: (id) => find(id)?.rating ?? null,
      avatarOf: (id) => find(id)?.avatar ?? null,
      playerOf: find,
      people: players
        .filter((p) => p.id !== rest.me?.id && p.last_seen_at)
        .sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? '') || a.name.localeCompare(b.name)),
      isOnline: (id) => {
        const seen = Date.parse(find(id)?.last_seen_at ?? '');
        return !Number.isNaN(seen) && this.now() - seen < ONLINE_FOR_MS;
      },
      now: () => this.now(),
    };
  }

  subscribe(listener: (s: LobbyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reloads in the background. Never throws. */
  async refresh(): Promise<void> {
    const n = ++this.started;
    try {
      const me = await this.api.me();
      const games = me ? await this.api.listGames(me.id) : [];
      const ids = new Set(games.flatMap((g) => [g.created_by, g.black, g.white, g.invited]).filter((id): id is string => !!id));
      const [named, seen] = me ? await Promise.all([this.api.players([...ids]), this.api.seenPlayers(me.id)]) : [[], []];
      const players = [...new Map([...named, ...seen].map((p) => [p.id, p])).values()];
      if (n < this.shown) return;
      this.shown = n;
      this.set({ me, games, players, online: true, unavailable: false });
    } catch (e) {
      if (n < this.shown) return;
      const problem = problemOf(e);
      this.set({ online: false, unavailable: problem === 'unavailable' });
      if (problem === 'failed' || problem === 'unavailable') this.onError(e);
    }
  }

  /** Tells the family this phone has Play online open, at most every 20 s. In the background: never throws. */
  private now() {
    return Date.now() + this.skew;
  }

  async present(): Promise<void> {
    if (!this.fields.me || Date.now() - this.presentAt < PRESENCE_EVERY_MS) return;
    this.presentAt = Date.now();
    try {
      const skew = Date.parse(await this.api.touchPresence()) - Date.now();
      if (!Number.isNaN(skew)) this.skew = skew;
    } catch (e) {
      this.presentAt = 0;
      if (problemOf(e) === 'failed') this.onError(e);
    }
  }

  register(name: string, familyCode: string): Promise<boolean> {
    return this.act(async () => {
      await this.api.register(name.trim(), familyCode);
      return true;
    }, false);
  }

  rename(name: string): Promise<boolean> {
    return this.act(async () => {
      await this.api.rename(name.trim());
      return true;
    }, false);
  }

  /** Creates a game with this phone in the given seat, with optional handicap; returns its id. */
  create(size: number, color: Color, handicap = 0): Promise<string | null> {
    return this.act(() => this.api.createGame(size, color, handicap), null);
  }

  /** Creates a game only this family member can join; returns its id. */
  ask(player: string, size: number, color: Color, handicap = 0): Promise<string | null> {
    return this.act(() => this.api.askToPlay(player, size, color, handicap), null);
  }

  /** Opens one of this phone's games, or joins someone else's open game. Returns the game id. */
  async open(gameId: string): Promise<string | null> {
    const me = this.fields.me;
    const game = this.fields.games.find((g) => g.id === gameId);
    if (me && game && (game.black === me.id || game.white === me.id)) return gameId;
    return this.act(async () => {
      await this.api.joinGame(gameId);
      return gameId;
    }, null);
  }

  /**
   * Puts the avatar this phone's player picked on their profile when it differs from what is stored. In the
   * background: never busy and never throws; an offline phone reports it on a later call.
   */
  async reportAvatar(avatar: string | null): Promise<void> {
    const me = this.fields.me;
    if (!me || (me.avatar ?? null) === avatar) return;
    try {
      await this.api.setMyAvatar(avatar);
      this.set({ me: { ...me, avatar } });
    } catch (e) {
      if (problemOf(e) === 'failed') this.onError(e);
    }
  }

  changeAvatar(avatar: string | null): Promise<boolean> {
    return this.act(async () => {
      await this.api.setMyAvatar(avatar);
      return true;
    }, false);
  }

  /** Withdraws an open game this phone created. */
  cancel(gameId: string): Promise<boolean> {
    return this.act(async () => {
      await this.api.cancelGame(gameId);
      return true;
    }, false);
  }

  private async act<T>(work: () => Promise<T>, failed: T): Promise<T> {
    if (this.fields.busy) return failed;
    this.set({ busy: true, problem: null });
    try {
      const result = await work();
      await this.refresh();
      return result;
    } catch (e) {
      const problem = problemOf(e);
      this.set(problem === 'unavailable' ? { problem, unavailable: true } : { problem });
      if (problem === 'failed' || problem === 'unavailable') this.onError(e);
      return failed;
    } finally {
      this.set({ busy: false });
    }
  }

  private set(changes: Partial<Fields>) {
    this.fields = { ...this.fields, ...changes };
    const state = this.state();
    for (const l of this.listeners) l(state);
  }
}
