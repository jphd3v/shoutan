// The online game behind the game screen and the lobby behind the menu's online view: loading,
// keeping them fresh, sending moves, and rating a finished game once.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { deadFrom, Playouts } from '../go/ai';
import { finishedGame, onlineGameOf } from '../go/finished';
import { Color, pass } from '../go/rules';
import { handicapFor, rated } from '../go/rating';
import { deadEstimatePlayouts, rematchSetup } from '../go/session';
import type { GameRow, GoApi } from '../net/api';
import type { Lobby, LobbyBackend } from '../net/lobby';
import { IntegrityProblem, MatchBackend, MatchSync, MatchView, playable } from '../net/match';
import type { GameEvent, OnlineGame } from '../online/log';
import { reporter } from '../report/install';
import { t } from '../ui/i18n';
import { addFinished, KeptGame, loadFinished, loadRatedGames, Profile, randomId, saveRatedGames } from '../ui/prefs';
import { actProblemText, lobbyProblemText } from './onlineText';
import { sendReports } from './reports';

/** What the online screens ask of the server. */
export type OnlineBackend = LobbyBackend & MatchBackend & Pick<GoApi, 'watchGame' | 'watchLobby'>;

/** The polls skip their turn while the app is in the background, and catch up as it comes back. */
const onScreen = () => AppState.currentState === 'active';

/**
 * How the lobby lists its games for the player `me`: those they sit in (a finished one only until the
 * phone has its record, since the profile lists it from then on), asks addressed to them, and open
 * games for anyone. A game this app can't play, or an ask for someone else, is left out.
 */
export function lobbySections(games: readonly GameRow[], me: string | undefined, kept: readonly KeptGame[]) {
  const recorded = new Set(kept.map((k) => onlineGameOf(k.game)));
  const seated = (g: GameRow) => g.black === me || g.white === me;
  return {
    mine: games.filter((g) => seated(g) && (g.status !== 'over' || !recorded.has(g.id))),
    asks: games.filter((g) => !seated(g) && playable(g) && g.invited === me),
    open: games.filter((g) => !seated(g) && playable(g) && !g.invited),
  };
}

/** Keeps the lobby fresh with Realtime hints, a poll and returning to the app; returns the stop. */
export function watchLobby(lobby: Lobby, connection: OnlineBackend): () => void {
  const update = () => {
    void lobby.refresh();
    void lobby.present();
  };
  update();
  const stop = connection.watchLobby(update, update);
  const timer = setInterval(() => {
    if (onScreen()) update();
  }, 5000);
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') update();
  });
  return () => {
    stop();
    clearInterval(timer);
    appState.remove();
  };
}

export interface OnlineMatch {
  id: string;
  view: MatchView;
  ready: Extract<MatchView, { kind: 'ready' }> | null;
  /** An action is on its way to the server. */
  busy: boolean;
  /** Why the last action did not happen, or why the game could not load. */
  error: string;
  /** A new object for every move the rules refused. */
  refusal: object | null;
  /** Whether the last read of the game reached the server. */
  reachable: boolean;
  /** The other player's rating as their phone reported it, or null. */
  theirRating: number | null;
  send: (event: GameEvent) => Promise<void>;
}

/**
 * The online game `id` as this phone sees it, or null when no game is open. Realtime is a
 * hint; a poll and coming back to the app catch anything it misses. Each phone rates its own
 * player once per finished game, against the other's reported rating (their own when unknown).
 */
/** Nothing a player can see differs: the same replayed state and the same row on the server. */
function sameView(a: MatchView, b: MatchView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'loading' || b.kind === 'loading') return true;
  const state = (v: MatchView) => ('state' in v ? v.state : null);
  return state(a) === state(b) && a.row.updated_at === b.row.updated_at && a.row.status === b.row.status;
}

export function useOnlineMatch(
  connection: OnlineBackend | null,
  id: string | null,
  me: string | null,
  opts: {
    profile: Profile;
    onRated: (p: Profile) => void;
    /** The finished games on this phone, after an online game was added to them. */
    onKept: (games: KeptGame[]) => void;
    ratingOf: (playerId: string | null) => number | null;
  },
): OnlineMatch | null {
  const [reachable, setReachable] = useState(true);
  const sync = useMemo(() => {
    if (!connection || !id || !me) return null;
    // Wrapped to tell whether the server is reached: MatchSync keeps its view on a failed read.
    const backend: MatchBackend = {
      gameRow: (gameId) =>
        connection.gameRow(gameId).then(
          (row) => {
            setReachable(true);
            return row;
          },
          (e: unknown) => {
            setReachable(false);
            throw e;
          },
        ),
      eventsAfter: (...a) => connection.eventsAfter(...a),
      addEvent: (...a) => connection.addEvent(...a),
      disputeGame: (...a) => connection.disputeGame(...a),
    };
    return new MatchSync(backend, id, me, (p) => reportIntegrityProblem(p, me));
  }, [connection, id, me]);
  const [view, setView] = useState<{ sync: MatchSync | null; view: MatchView }>({ sync, view: { kind: 'loading' } });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<object | null>(null);
  // A view belongs to the game it was read for, so another game never shows for a moment.
  const shown: MatchView = view.sync === sync ? view.view : { kind: 'loading' };
  if (view.sync !== sync) {
    setView({ sync, view: { kind: 'loading' } });
    setError('');
    setRefusal(null);
  }

  // A finished game no longer changes, so the steady poll stops; hints and returning to the app still refresh it.
  const over = shown.kind === 'ready' && shown.turn === 'over';
  const overRef = useRef(over);
  overRef.current = over;
  useEffect(() => {
    if (!sync || !connection || !id) return;
    const update = () =>
      void sync.refresh().then(
        // A poll that finds nothing new keeps the same view, so the game screen doesn't redraw.
        (v) => setView((cur) => (cur.sync === sync && sameView(cur.view, v) ? cur : { sync, view: v })),
        (e: unknown) => {
          setError(lobbyProblemText('offline'));
          reporter.captureError(e, 'error', 'load game');
        },
      );
    update();
    const stop = connection.watchGame(id, { event: update, game: update, ready: update });
    const timer = setInterval(() => {
      if (!overRef.current && onScreen()) update();
    }, 3000);
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') update();
    });
    return () => {
      stop();
      clearInterval(timer);
      appState.remove();
    };
  }, [connection, id, sync]);

  // From the first time the app opens, so the first game this phone finishes counts.
  useEffect(() => void loadRatedGames(), []);
  const ready = shown.kind === 'ready' ? shown : null;
  const theirRating = ready?.you ? opts.ratingOf(ready.row[ready.you === 'black' ? 'white' : 'black']) : null;
  const { profile, onRated, onKept } = opts;
  // A finished game is kept once, with the rating change when it moved the rating. Games that
  // ended before ratings existed do not count.
  useEffect(() => {
    const result = ready?.turn === 'over' ? ready.state.game.result : undefined;
    if (!id || !ready?.you || !result) return;
    const done = loadRatedGames();
    const rate = !done.ids.includes(id) && Date.parse(ready.row.updated_at) >= Date.parse(done.since);
    const opponentRating = theirRating ?? profile.rating;
    const next = rate
      ? rated(profile, opponentRating, result.winner === ready.you ? 'win' : 'loss', ready.state.meta.handicap, ready.you)
      : null;
    if (next || !loadFinished().some(({ game }) => onlineGameOf(game) === id)) {
      const record = finishedGame(ready.state.game, {
        id: randomId(),
        mode: 'online',
        rules: ready.state.meta.rulesVersion,
        onlineGame: id,
        opponent: ready.row[ready.you === 'black' ? 'white' : 'black'],
        // Server times: the first event and the one that ended the game.
        startedAt: ready.played?.from ?? null,
        endedAt: ready.played?.to ?? ready.row.updated_at,
        player: ready.row[ready.you],
        you: ready.you,
        ...(next ? { rating: { before: profile.rating, after: next.rating, opponent: opponentRating } } : {}),
      });
      if (record) onKept(addFinished(record));
    }
    if (!next) return;
    saveRatedGames({ ...done, ids: [...done.ids, id] });
    onRated({ ...profile, ...next });
  }, [ready, id, profile, theirRating, onRated, onKept]);

  // A pass that would end play carries the dead-stone guess, seconds of playouts on a phone: worked
  // out in slices while the player decides, so the pass goes out at once.
  const deadAfterPass = useRef<{ state: OnlineGame; dead: number[] } | null>(null);
  const answering = ready?.turn === 'yours' && ready.state.game.moves[ready.state.game.moves.length - 1]?.kind === 'pass';
  const answeringState = answering ? ready.state : null;
  useEffect(() => {
    if (!answeringState) return;
    const playouts = new Playouts(pass(answeringState.game), { playouts: deadEstimatePlayouts(answeringState.game.size) });
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const sliceEnd = Date.now() + 30;
      while (!playouts.finished && Date.now() < sliceEnd) playouts.run(10);
      if (playouts.finished) deadAfterPass.current = { state: answeringState, dead: deadFrom(playouts).dead };
      else timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [answeringState]);

  if (!sync || !id) return null;
  const send = async (action: GameEvent) => {
    if (busy) return;
    setBusy(true);
    const guessed = deadAfterPass.current;
    const event = action.kind === 'pass' && guessed && guessed.state === ready?.state ? { ...action, dead: guessed.dead } : action;
    try {
      reporter.breadcrumb(`online ${event.kind}`);
      const r = await sync.act(event);
      setView({ sync, view: sync.view() });
      setError(r.ok ? '' : actProblemText(r.problem));
      setRefusal(!r.ok && r.problem.kind === 'illegal' ? {} : null);
      if (!r.ok && r.problem.kind === 'rejected') reporter.captureError(r.problem.error, 'error', 'send move');
    } finally {
      setBusy(false);
    }
  };
  return { id, view: shown, ready, busy, error, refusal, reachable, theirRating, send };
}

/**
 * The next game between the same two people: from both ratings when the other phone has
 * reported one, otherwise from this result alone (the loser gets Black or a stone more).
 */
export function rematchFor(r: {
  you: Color;
  winner: Color;
  size: number;
  handicap: number;
  myRating: number;
  theirRating: number | null;
}): {
  seat: Color;
  handicap: number;
} {
  if (r.theirRating !== null) {
    const fit = handicapFor(r.myRating, r.theirRating, r.size);
    return { seat: fit.black === 'a' ? 'black' : 'white', handicap: fit.handicap };
  }
  const fit = rematchSetup(r.handicap, r.winner, r.size);
  return { seat: (fit.black === 'winner') === (r.you === r.winner) ? 'black' : 'white', handicap: fit.handicap };
}

/** The other person in a listed game, from this phone's side. */
export const opponentIn = (g: GameRow, me: string) => (g.created_by !== me ? g.created_by : g.black === me ? g.white : g.black);

/** What a game with someone means in stones on 19×19, from this player's side; empty when their rating is unknown. */
export function stonesText(mine: number, theirs: number | null): string {
  if (theirs === null) return '';
  const fit = handicapFor(mine, theirs, 19);
  if (!fit.handicap) return t('even game');
  if (fit.handicap === 1) return fit.black === 'a' ? t('you take 1 stone') : t('you give 1 stone');
  return fit.black === 'a' ? t('you take {n} stones', { n: fit.handicap }) : t('you give {n} stones', { n: fit.handicap });
}

/** Integrity problems are reported like crashes: they mean a bug, a version mix-up or tampering. */
function reportIntegrityProblem(p: IntegrityProblem, owner: string | null) {
  reporter.captureError(new Error(`Online game stopped at event ${p.n}: ${p.reason}`), 'error', 'integrity');
  reporter.breadcrumb(`integrity ${p.gameId} ${JSON.stringify(p.detail).slice(0, 500)}`);
  if (owner) void sendReports(owner);
}
