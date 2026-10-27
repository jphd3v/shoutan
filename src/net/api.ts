/**
 * Everything the app asks of Supabase. The client is passed in so the same code
 * runs in the app (session kept on the phone) and in the database tests (Node).
 */
import type { RealtimeChannel, SupabaseClient, User } from '@supabase/supabase-js';
import type { FinishedGame } from '../go/finished';
import type { Level } from '../go/rating';
import type { Color, Result } from '../go/rules';
import type { SealedEvent, Summary } from '../online/log';

/**
 * Sent with every sign-in code request. The project's e-mail templates are shared with another app,
 * so they tell Shoutan's e-mails apart by it (`{{ .RedirectTo }}`); it must be in the project's
 * allowed redirect URLs, or Supabase replaces it with the site URL. No link uses it: phones sign in
 * with the code.
 */
export const SIGN_IN_REDIRECT = 'shoutan://sign-in';

export interface Account {
  id: string;
  email: string;
}

const accountOf = (user: Pick<User, 'id' | 'email' | 'is_anonymous'> | null | undefined): Account | null =>
  user?.id && !user.is_anonymous && user.email ? { id: user.id, email: user.email } : null;

/** The account in a session as auth-js saved it, checked field by field: storage is not typed. */
function storedAccount(saved: unknown): Account | null {
  if (!saved || typeof saved !== 'object' || !('user' in saved)) return null;
  const user = saved.user;
  if (!user || typeof user !== 'object' || !('id' in user) || !('email' in user)) return null;
  if (typeof user.id !== 'string' || typeof user.email !== 'string') return null;
  return accountOf({ id: user.id, email: user.email, is_anonymous: 'is_anonymous' in user && user.is_anonymous === true });
}

export type GameStatus = 'open' | 'playing' | 'scoring' | 'over' | 'disputed';

export interface GameRow {
  id: string;
  size: number;
  komi: number;
  black: string | null;
  white: string | null;
  created_by: string;
  /** The family member an open game is addressed to, who alone can join it; null for a game open to anyone. */
  invited?: string | null;
  status: GameStatus;
  to_play: Color;
  move_count: number;
  result: Result | null;
  rules_version: number;
  /** Black's handicap stones, 0 for an even game. */
  handicap: number;
  /** Hash of the last event; null before the first one. */
  head_hash: string | null;
  black_accepted: boolean;
  white_accepted: boolean;
  dispute: { n: number; reason: string; by: string } | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  game_id: string;
  n: number;
  player: string;
  /** Untrusted until checked with parseEvent. */
  event: unknown;
  /** When the server stored it. */
  created_at: string;
}

export interface Player {
  id: string;
  name: string;
  /** EGF-scale rating, worked out by the server from the player's game records; null until their phone reports a level. */
  rating: number | null;
  rated_games: number;
  /** The level the player's rating last started from, and when; null until their phone reports it. */
  level: Level | null;
  rating_since: string | null;
  /** The emoji the player picked on their phone; null until they pick one. */
  avatar: string | null;
  /** When the player's phone last had Play online open; null until it has. */
  last_seen_at?: string | null;
}

/** One of the player's own finished-game records as the server keeps it. */
export interface RecordRow {
  id: string;
  /** Untrusted until read with `readFinished`. */
  record: unknown;
  uploaded_at: string;
}

/** Where reading the player's records stopped: the last record read. */
export interface RecordCursor {
  uploadedAt: string;
  id: string;
}

export interface Release {
  version_code: number;
  version_name: string;
  notes: string;
}

export interface NewReport {
  kind: 'crash' | 'error' | 'bug' | 'idea';
  message: string;
  details: Record<string, unknown>;
  fingerprint?: string;
  occurrences?: number;
  app_version?: string;
  player_name?: string;
}

/** Errors raised by the database functions, by the name they raise. */
const KNOWN = [
  'not_signed_in',
  'wrong_family_code',
  'name_taken',
  'not_a_player',
  'game_not_open',
  'game_not_running',
  'game_disputed',
  'own_game',
  'not_invited',
  'bad_player',
  'out_of_sync',
  'broken_chain',
  'not_your_turn',
  'not_your_game',
  'not_scoring',
  'already_accepted',
  'wrong_color',
  'bad_event',
  'bad_summary',
  'bad_game',
  'bad_level',
  'too_many_open_games',
] as const;
/**
 * `network`: the server was not reached, timed out or failed on its side (HTTP 0 or 5xx), so trying
 * again later may work. supabase-js reports that as an error result, not a throw.
 * `unavailable`: the server works but online play is not set up on it (anonymous sign-ins off,
 * or the Go schema missing or not exposed).
 */
export type ApiErrorCode = (typeof KNOWN)[number] | 'network' | 'unavailable' | 'unknown';

const UNREACHABLE = /network request failed|network request timed out|timed? ?out|failed to fetch|fetch failed|load failed|aborted/i;
const NOT_SET_UP = /anonymous sign-ins are disabled|invalid schema|schema must be one of/i;

/** What went wrong, from the error's message and, when known, the HTTP status of the reply. */
export function errorCode(message: string, status?: number): ApiErrorCode {
  const known = KNOWN.find((k) => message.includes(k));
  if (known) return known;
  if (NOT_SET_UP.test(message)) return 'unavailable';
  if (UNREACHABLE.test(message) || status === 0 || (status !== undefined && status >= 500)) return 'network';
  return 'unknown';
}

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function check<T>(r: { data: T; error: { message: string; status?: number } | null; status?: number }): T {
  if (r.error) {
    throw new ApiError(errorCode(r.error.message, r.error.status ?? r.status), r.error.message);
  }
  return r.data;
}

const PLAYER_COLUMNS = 'id,name,rating,rated_games,avatar,level,rating_since,last_seen_at';
const GAME_COLUMNS =
  'id,size,komi,black,white,created_by,invited,status,to_play,move_count,result,rules_version,handicap,head_hash,black_accepted,white_accepted,dispute,created_at,updated_at';

export class GoApi {
  constructor(
    private readonly db: SupabaseClient,
    private readonly schema = 'public',
    private readonly owner?: string,
  ) {}

  forAccount(owner: string): GoApi {
    return new GoApi(this.db, this.schema, owner);
  }

  private async request<T>(
    query: PromiseLike<{ data: T; error: { message: string } | null; status?: number }> & {
      setHeader(name: string, value: string): unknown;
    },
  ): Promise<T> {
    const { data, error } = await this.db.auth.getSession();
    if (error) throw new ApiError(errorCode(error.message, error.status), error.message);
    const session = data.session;
    if (!session || session.user.is_anonymous || !session.user.email || (this.owner && session.user.id !== this.owner))
      throw new ApiError('not_signed_in', 'not_signed_in');
    query.setHeader('Authorization', `Bearer ${session.access_token}`);
    return check(await query);
  }

  /**
   * The permanent login kept on this device, read from storage without the network: an expired
   * token offline must neither hold up the launch nor hide the account's saves. Requests refresh it.
   */
  async account(): Promise<Account | null> {
    // auth-js keeps its storage and key protected; read them as the untyped values they are here.
    const storage: unknown = Reflect.get(this.db.auth, 'storage');
    const key: unknown = Reflect.get(this.db.auth, 'storageKey');
    if (
      typeof key !== 'string' ||
      typeof storage !== 'object' ||
      !storage ||
      !('getItem' in storage) ||
      typeof storage.getItem !== 'function'
    )
      return null;
    try {
      const raw: unknown = await storage.getItem(key);
      return typeof raw === 'string' ? storedAccount(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  /** Follows sign-in and sign-out. The initial event is skipped: offline it reports no session while one is kept. */
  watchAccount(onChange: (account: Account | null) => void): () => void {
    const { data } = this.db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') onChange(null);
      else if (event !== 'INITIAL_SESSION' && accountOf(session?.user)) onChange(accountOf(session?.user));
    });
    return () => data.subscription.unsubscribe();
  }

  async sendCode(email: string): Promise<void> {
    check(await this.db.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { emailRedirectTo: SIGN_IN_REDIRECT } }));
  }

  async verifyCode(email: string, token: string): Promise<void> {
    check(await this.db.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' }));
  }

  async signOut(): Promise<void> {
    check({ data: null, ...(await this.db.auth.signOut({ scope: 'local' })) });
  }

  /** Requires a login chosen by the player, never a background anonymous sign-in. */
  async signIn(): Promise<string> {
    const account = await this.account();
    if (!account || (this.owner && account.id !== this.owner)) throw new ApiError('not_signed_in', 'not_signed_in');
    return account.id;
  }

  async me(): Promise<Player | null> {
    const account = await this.account();
    if (!account) return null;
    const id = account.id;
    return this.request(this.db.schema(this.schema).from('players').select(PLAYER_COLUMNS).eq('id', id).maybeSingle<Player>());
  }

  async register(name: string, familyCode: string): Promise<void> {
    await this.signIn();
    await this.request(this.db.schema(this.schema).rpc('register_player', { p_name: name, p_family_code: familyCode }));
  }

  /**
   * The level the player's rating starts from, and since when: the server works out the rating from
   * their game records since then. An older choice than the stored one changes nothing.
   */
  async setMyLevel(level: Level, since: string): Promise<void> {
    await this.request(this.db.schema(this.schema).rpc('set_my_level', { p_level: level, p_since: since }));
  }

  /** Stores the avatar this phone's player picked, or clears it, so the family's phones show it. */
  async setMyAvatar(avatar: string | null): Promise<void> {
    await this.request(this.db.schema(this.schema).rpc('set_my_avatar', { p_avatar: avatar }));
  }

  async rename(name: string): Promise<void> {
    await this.request(this.db.schema(this.schema).rpc('rename_player', { p_name: name }));
  }

  /** The names of these players. Asking only for the ones on screen stays under the API's row limit. */
  async players(ids: readonly string[]): Promise<Player[]> {
    if (!ids.length) return [];
    return (
      (await this.request(
        this.db
          .schema(this.schema)
          .from('players')
          .select(PLAYER_COLUMNS)
          .in('id', [...ids])
          .returns<Player[]>(),
      )) ?? []
    );
  }

  /** Says this phone has Play online open; the server keeps a time stamp the family reads. Returns the server's time. */
  async touchPresence(): Promise<string> {
    return (await this.request(this.db.schema(this.schema).rpc('touch_presence'))) as string;
  }

  /** The other members seen with Play online open, the latest first. */
  async seenPlayers(me: string): Promise<Player[]> {
    const query = this.db
      .schema(this.schema)
      .from('players')
      .select(PLAYER_COLUMNS)
      .neq('id', me)
      .not('last_seen_at', 'is', null)
      .order('last_seen_at', { ascending: false })
      .limit(100);
    return (await this.request(query.returns<Player[]>())) ?? [];
  }

  /**
   * Open games plus the caller's own, most recently active first. The caller's live games come in
   * a query of their own, so finished games and other people's open ones never push them off the list.
   */
  async listGames(me: string): Promise<GameRow[]> {
    const games = () => this.db.schema(this.schema).from('games').select(GAME_COLUMNS).order('updated_at', { ascending: false });
    const mine = `black.eq.${me},white.eq.${me}`;
    const [live, open, finished] = await Promise.all([
      this.request(games().in('status', ['open', 'playing', 'scoring']).or(mine).limit(100).returns<GameRow[]>()),
      this.request(games().eq('status', 'open').limit(50).returns<GameRow[]>()),
      this.request(games().in('status', ['over', 'disputed']).or(mine).limit(20).returns<GameRow[]>()),
    ]);
    const byId = new Map([live, open, finished].flatMap((r) => r ?? []).map((g) => [g.id, g]));
    return [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async createGame(size: number, color: Color, handicap = 0): Promise<string> {
    const args = { p_size: size, p_color: color, p_handicap: handicap };
    return (await this.request(this.db.schema(this.schema).rpc('create_game', args))) as string;
  }

  /** Creates an open game only `player` can join. */
  async askToPlay(player: string, size: number, color: Color, handicap = 0): Promise<string> {
    const args = { p_player: player, p_size: size, p_color: color, p_handicap: handicap };
    return (await this.request(this.db.schema(this.schema).rpc('ask_to_play', args))) as string;
  }

  async joinGame(id: string): Promise<void> {
    await this.request(this.db.schema(this.schema).rpc('join_game', { p_game: id }));
  }

  async cancelGame(id: string): Promise<void> {
    await this.request(this.db.schema(this.schema).rpc('cancel_game', { p_game: id }));
  }

  async gameRow(id: string): Promise<GameRow> {
    const game = await this.request(this.db.schema(this.schema).from('games').select(GAME_COLUMNS).eq('id', id).maybeSingle<GameRow>());
    if (!game) throw new ApiError('unknown', `Game ${id} not found`);
    return game;
  }

  /**
   * Events after number `after`, up to and including `upTo`, in order. Throws `out_of_sync`
   * if any is missing, so a caller never sees a history with gaps.
   */
  async eventsAfter(id: string, after: number, upTo: number): Promise<EventRow[]> {
    const events: EventRow[] = [];
    while (after + events.length < upTo) {
      const from = after + events.length;
      const batch = await this.request(
        this.db
          .schema(this.schema)
          .from('game_events')
          .select('game_id,n,player,event,created_at')
          .eq('game_id', id)
          .gt('n', from)
          .lte('n', upTo)
          .order('n')
          .limit(1000)
          .returns<EventRow[]>(),
      );
      if (!batch?.length || batch.some((e, i) => e.n !== from + i + 1)) throw new ApiError('out_of_sync', 'Game history is incomplete');
      events.push(...batch);
    }
    return events;
  }

  async loadGame(id: string): Promise<{ game: GameRow; events: EventRow[] }> {
    const game = await this.gameRow(id);
    return { game, events: await this.eventsAfter(id, 0, game.move_count) };
  }

  /** Stops a game whose stored history this phone cannot verify, at event `n`. */
  async disputeGame(id: string, n: number, reason: string): Promise<void> {
    await this.request(this.db.schema(this.schema).rpc('dispute_game', { p_game: id, p_n: n, p_reason: reason }));
  }

  /** Appends event number `n`. Throws `out_of_sync` when another event got there first. */
  async addEvent(id: string, n: number, event: SealedEvent, s: Summary): Promise<void> {
    await this.request(
      this.db.schema(this.schema).rpc('add_event', {
        p_game: id,
        p_n: n,
        p_event: event,
        p_status: s.status,
        p_to_play: s.toPlay,
        p_result: s.result,
      }),
    );
  }

  /**
   * Calls back on every new event and game update. `ready` fires once the database
   * confirms the subscription, to catch up on anything missed before it; `lost` when
   * the connection drops (the client reconnects by itself). Realtime is only a hint:
   * callers must also poll, because changes can be missed around reconnects.
   */
  watchGame(
    id: string,
    on: { event: (e: EventRow) => void; game: (g: GameRow) => void; ready: () => void; lost?: (why: string) => void },
  ): () => void {
    const channel = this.db
      .channel(`game:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: this.schema, table: 'game_events', filter: `game_id=eq.${id}` }, (p) =>
        on.event(p.new as EventRow),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: this.schema, table: 'games', filter: `id=eq.${id}` }, (p) =>
        on.game(p.new as GameRow),
      )
      .on('system', {}, (p: { extension?: string; status?: string }) => {
        if (p.extension === 'postgres_changes' && p.status === 'ok') on.ready();
      })
      .subscribe((status, err) => {
        if (status !== 'SUBSCRIBED') on.lost?.(`${status}${err ? `: ${err.message}` : ''}`);
      });
    return () => void this.remove(channel);
  }

  /** Calls back whenever any game changes, so the lobby can refresh. */
  watchLobby(onChange: () => void, onReady: () => void): () => void {
    const channel = this.db
      .channel('lobby')
      .on('postgres_changes', { event: '*', schema: this.schema, table: 'games' }, () => onChange())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onReady();
      });
    return () => void this.remove(channel);
  }

  /**
   * Keeps a finished game on the server as it is, under its own id: sending it again changes
   * nothing, and a recount replaces it.
   */
  async recordFinishedGame(g: FinishedGame, appVersion: string): Promise<void> {
    await this.request(this.db.schema(this.schema).rpc('record_game', { p: g, version: appVersion }));
  }

  /**
   * The player's own records kept or replaced after `after` (the last one the phone has), oldest
   * first, at most `limit`. Each record is untrusted until read with `readFinished`.
   */
  async myRecords(after: RecordCursor | null, limit = 100): Promise<RecordRow[]> {
    return (
      ((await this.request(
        this.db
          .schema(this.schema)
          .rpc('my_game_records', { p_after: after?.uploadedAt ?? null, p_after_id: after?.id ?? null, p_limit: limit }),
      )) as RecordRow[] | null) ?? []
    );
  }

  async sendReports(reports: NewReport[]): Promise<void> {
    await this.request(this.db.schema(this.schema).from('reports').insert(reports));
  }

  async latestRelease(): Promise<Release | null> {
    return this.request(
      this.db
        .schema(this.schema)
        .from('releases')
        .select('version_code,version_name,notes')
        .order('version_code', { ascending: false })
        .limit(1)
        .maybeSingle<Release>(),
    );
  }

  private async remove(channel: RealtimeChannel) {
    await this.db.removeChannel(channel);
  }
}
