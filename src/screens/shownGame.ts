import { useEffect, useMemo } from 'react';
import { FinishedGame, replayFinished } from '../go/finished';
import { gameRecord } from '../go/record';
import { Color, GameState, newGame } from '../go/rules';
import { Action, actingColor, aiColor, canFixDead, canRedo, canUndo, isAiTurn, Session } from '../go/session';
import type { Lobby, LobbyState } from '../net/lobby';
import { BOT_AVATAR } from '../ui/avatars';
import { illegalText, Who } from '../ui/copy';
import { t } from '../ui/i18n';
import type { Profile } from '../ui/prefs';
import { resignWarningText, resultText, statusText, whoIs } from './gameText';
import { OnlineMatch, rematchFor } from './onlineMatch';
import { onlineStatus } from './onlineText';

/** A button in the control row: whether it can be tapped now, and what it does. */
export interface Control {
  enabled: boolean;
  run: () => void;
}

/** The control row under the board, as the game on screen offers it. */
export interface Controls {
  /** `none` while an online game is not yet the player's to act in. */
  stage: 'none' | 'waiting' | 'playing' | 'scoring' | 'over';
  pass: Control;
  resume: Control;
  /** `nudge`: draw the eye to Count once nothing on the board is left to check. */
  accept: Control & { label: string; nudge: boolean };
  /** New game, or an online rematch; null when there is none. */
  again: { label: string; run: () => void; icon?: 'refresh' | 'checkmark' } | null;
  /** Undo and redo, for the game on this phone. */
  undo?: Control;
  redo?: Control;
  /** Cancelling an online game nobody has joined yet. */
  cancel?: Control;
}

/**
 * The game on screen as the screen needs it, whichever game that is: the game on this phone or an
 * online one. Everything that differs between the two is decided here, so the screen asks once.
 */
export interface ShownGame {
  /** Changes when another game is shown, so nothing on screen takes the switch for a move. */
  key: string;
  game: GameState;
  /** The game itself is on the board; an online game shows an empty board while it loads. */
  loaded: boolean;
  /** The player holding the phone, or null face to face. */
  viewer: Color | null;
  /** Two players sit across the phone from each other. */
  facing: boolean;
  /** The bot's colour in a game against it. */
  bot: Color | null;
  who: (c: Color) => Who;
  nameOf: (c: Color) => string;
  avatarOf: (c: Color) => string | null;
  /** The family member in a seat of an online game; null in games on this phone. */
  memberOf: (c: Color) => string | null;
  /** The player at the phone may move now. */
  canPlay: boolean;
  /** The bot is searching for its move. */
  thinking: boolean;
  /** A move is awaited from the other side: the bot, the other phone, or this phone's move on its way. */
  waiting: boolean;
  /** The status line; `quiet` leaves out a refused move, which a note over the board explains instead. */
  status: (preview: number | null, quiet?: boolean) => string;
  /** The status line reports a problem. */
  warning: boolean;
  /** Whose turn it is is all the status line would say, which the player cards already show. */
  plainTurn: (preview: number | null) => boolean;
  /** The result, once there is one to show. */
  result: { title: string; subtitle: string } | null;
  /** A new object for every refused move, and its explanation. */
  refusal: object | null;
  refusedText: () => string | null;
  /** What a tap on the board does now. */
  tapMode: 'ignore' | 'play' | 'mark';
  tap: (point: number) => void;
  controls: Controls;
  /** What resigning would mean, or null when there is nothing to resign. */
  resignWarning: string | null;
  resign: () => void;
  /** Another game with the same settings; absent online. */
  newGame?: () => void;
  /** Back from the result to marking dead stones; absent when that is not possible. */
  fixDead?: () => void;
  /** The latest change undid or redid a move, which the board shows differently from a new one. */
  undone: boolean;
  redone: boolean;
  /** The other side's moves chime, as they arrive while the player waits. */
  chimeForOpponent: boolean;
  /** Whether the online game reached the server last time; null for the game on this phone. */
  reachable: boolean | null;
  /** What a report about this game carries besides the screen. */
  report: Record<string, unknown>;
  /** What the score estimate is kept for: it starts again for another game. */
  estimateKey: unknown;
}

/** The game on this phone. */
function sessionGame(d: {
  session: Session;
  dispatch: (a: Action) => void;
  lastAction: Action['type'] | null;
  profile: Profile;
  onNewGame: () => void;
}): ShownGame {
  const { session, dispatch } = d;
  const { game } = session;
  const bot = aiColor(session);
  const thinking = isAiTurn(session);
  const facing = session.settings.opponent === 'human';
  const last = game.moves[game.moves.length - 1];
  const who = (c: Color) => whoIs(session, c);
  return {
    key: 'offline',
    game,
    loaded: true,
    viewer: bot ? session.settings.humanColor : null,
    facing,
    bot,
    who,
    nameOf: (c) => (bot ? (c === bot ? t('Bot') : d.profile.name?.trim() || t('You')) : c === 'black' ? t('Black') : t('White')),
    // Face to face neither seat is the phone's owner, so neither card shows the owner's avatar.
    avatarOf: (c) => (bot ? (c === bot ? BOT_AVATAR : (d.profile.avatar ?? null)) : null),
    memberOf: () => null,
    canPlay: game.phase === 'playing' && !thinking,
    thinking,
    waiting: thinking,
    status: (preview, quiet) => statusText(quiet ? { ...session, lastIllegal: undefined } : session, preview, facing),
    warning: false,
    plainTurn: (preview) => thinking || (preview === null && last?.kind !== 'pass'),
    result: game.result ? resultText(game, who) : null,
    refusal: session.lastIllegal ? session : null,
    refusedText: () => (session.lastIllegal ? illegalText(session.lastIllegal) : null),
    tapMode: 'play',
    tap: (point) => dispatch({ type: 'tap', point }),
    controls: {
      stage: game.phase,
      pass: { enabled: !thinking, run: () => dispatch({ type: 'pass' }) },
      resume: { enabled: true, run: () => dispatch({ type: 'resume' }) },
      accept: {
        label: t('Count'),
        enabled: !session.guessing,
        nudge: !session.guessing && !game.unsure?.size,
        run: () => dispatch({ type: 'accept' }),
      },
      again: { label: t('New game'), run: d.onNewGame },
      undo: { enabled: canUndo(session), run: () => dispatch({ type: 'undo' }) },
      redo: { enabled: canRedo(session), run: () => dispatch({ type: 'redo' }) },
    },
    resignWarning: game.phase === 'over' ? null : resignWarningText(who(actingColor(session))),
    resign: () => dispatch({ type: 'resign' }),
    newGame: d.onNewGame,
    fixDead: canFixDead(session) ? () => dispatch({ type: 'fixDead' }) : undefined,
    undone: d.lastAction === 'undo',
    redone: d.lastAction === 'redo',
    chimeForOpponent: false,
    reachable: null,
    report: { mode: session.settings.opponent, game: gameRecord(game).slice(-24000) },
    estimateKey: session.history[0] ?? session.game,
  };
}

/** An online game, from this phone's seat. */
function onlineGame(d: {
  online: OnlineMatch;
  placeholder: GameState;
  lobby: Lobby | null;
  lobbyState: LobbyState | null;
  profile: Profile;
  me: { name: string } | null;
  onOpened: (gameId: string | null) => void;
  onCancelled: () => void;
}): ShownGame {
  const { online, lobby, lobbyState } = d;
  const { view, ready } = online;
  const seat = ready?.you ?? null;
  const row = view.kind !== 'loading' ? view.row : null;
  const state = view.kind === 'ready' || view.kind === 'stopped' ? view.state : null;
  const game = state?.game ?? d.placeholder;
  const turn = ready?.turn;
  const nameOf = (c: Color) => (row && lobbyState?.nameOf(row[c])) || (c === 'black' ? t('Black') : t('White'));
  const who = (c: Color): Who => (c === seat ? 'you' : { name: nameOf(c) });
  const refused = !!online.refusal;
  const last = game.moves[game.moves.length - 1];
  const send = (event: Parameters<OnlineMatch['send']>[0]) => void online.send(event);
  const accepted = !!(seat && ready?.state.accepted[seat]);
  const rematch =
    seat && ready && game.result
      ? rematchFor({
          you: seat,
          winner: game.result.winner,
          size: game.size,
          handicap: ready.state.meta.handicap,
          myRating: d.profile.rating,
          theirRating: online.theirRating,
        })
      : null;
  return {
    key: `online:${online.id}:${view.kind}`,
    game,
    loaded: !!state,
    viewer: seat,
    facing: false,
    bot: null,
    who,
    nameOf,
    avatarOf: (c) => (row ? (lobbyState?.avatarOf(row[c]) ?? null) : null),
    memberOf: (c) => row?.[c] ?? null,
    canPlay: turn === 'yours' && !online.busy,
    thinking: false,
    waiting: online.busy || turn === 'theirs',
    status: (preview, quiet) => onlineStatus(view, { error: quiet && refused ? '' : online.error, preview: preview !== null, nameOf }),
    warning: (!!online.error && !refused) || view.kind === 'stopped',
    plainTurn: (preview) =>
      (!online.error || refused) && ((turn === 'yours' && preview === null && last?.kind !== 'pass') || turn === 'theirs'),
    result: ready && game.result ? resultText(game, who) : null,
    refusal: online.refusal,
    refusedText: () => online.error || null,
    tapMode: !seat || online.busy ? 'ignore' : turn === 'scoring' ? 'mark' : turn === 'yours' ? 'play' : 'ignore',
    tap: (point) => {
      if (!seat) return;
      send(turn === 'scoring' ? { kind: 'mark', color: seat, point } : { kind: 'play', color: seat, point });
    },
    controls: {
      stage: !seat || !ready ? 'none' : turn === 'yours' || turn === 'theirs' ? 'playing' : (turn ?? 'none'),
      pass: { enabled: turn === 'yours' && !online.busy, run: () => seat && send({ kind: 'pass', color: seat }) },
      resume: { enabled: !online.busy, run: () => seat && send({ kind: 'resume', color: seat }) },
      accept: {
        label: accepted ? t('Waiting for agreement') : t('Count'),
        enabled: !online.busy && !accepted,
        nudge: !accepted && !ready?.state.game.unsure?.size,
        run: () => seat && send({ kind: 'accept', color: seat }),
      },
      again: rematch
        ? {
            label:
              rematch.handicap === 1
                ? t('Rematch with 1 stone')
                : rematch.handicap
                  ? t('Rematch with {n} stones', { n: rematch.handicap })
                  : t('Rematch'),
            run: () => void lobby?.create(game.size, rematch.seat, rematch.handicap).then(d.onOpened),
          }
        : null,
      cancel: {
        enabled: !online.busy && !lobbyState?.busy,
        run: () =>
          void lobby?.cancel(online.id).then((cancelled) => {
            if (cancelled) d.onCancelled();
          }),
      },
    },
    resignWarning: seat && ready && game.phase !== 'over' ? resignWarningText('you') : null,
    resign: () => seat && send({ kind: 'resign', color: seat }),
    undone: false,
    redone: false,
    chimeForOpponent: true,
    reachable: online.reachable,
    report: { mode: 'online', player_name: d.me?.name, game_id: online.id, events: state?.events.slice(-100) },
    estimateKey: online.id,
  };
}

/** A finished game from the player's list, replayed from its record: nothing in it can be played. */
function reviewGame(d: {
  record: FinishedGame;
  game: GameState;
  lobbyState: LobbyState | null;
  profile: Profile;
  onDone: () => void;
}): ShownGame {
  const { record, game } = d;
  const { mode, you, opponent } = record.meta;
  const bot = mode === 'bot' && you ? (you === 'black' ? 'white' : 'black') : null;
  const opponentName = (opponent && d.lobbyState?.nameOf(opponent)) || t('Opponent');
  const who = (c: Color): Who => (c === you ? 'you' : bot ? 'bot' : mode === 'online' ? { name: opponentName } : c);
  const none = { enabled: false, run: () => {} };
  return {
    key: `review:${record.id}`,
    game,
    loaded: true,
    viewer: you,
    facing: false,
    bot,
    who,
    nameOf: (c) =>
      c === you
        ? d.profile.name?.trim() || t('You')
        : bot
          ? t('Bot')
          : mode === 'online'
            ? opponentName
            : c === 'black'
              ? t('Black')
              : t('White'),
    avatarOf: (c) =>
      c === you
        ? (d.profile.avatar ?? null)
        : bot
          ? BOT_AVATAR
          : mode === 'online' && opponent
            ? (d.lobbyState?.avatarOf(opponent) ?? null)
            : null,
    memberOf: (c) => (mode === 'online' && c !== you ? (opponent ?? null) : null),
    canPlay: false,
    thinking: false,
    waiting: false,
    status: () => t('Game over'),
    warning: false,
    plainTurn: () => false,
    result: resultText(game, who),
    refusal: null,
    refusedText: () => null,
    tapMode: 'ignore',
    tap: () => {},
    controls: {
      stage: 'over',
      pass: none,
      resume: none,
      accept: { ...none, label: t('Count'), nudge: false },
      again: { label: t('Done'), run: d.onDone, icon: 'checkmark' },
    },
    resignWarning: null,
    resign: () => {},
    undone: false,
    redone: false,
    chimeForOpponent: false,
    reachable: null,
    report: { mode: 'review', record: record.id },
    estimateKey: record.id,
  };
}

/** A finished game under review, else the online game when one is open, otherwise the game on this phone. */
export function useShownGame(d: {
  session: Session;
  dispatch: (a: Action) => void;
  lastAction: Action['type'] | null;
  online: OnlineMatch | null;
  lobby: Lobby | null;
  lobbyState: LobbyState | null;
  profile: Profile;
  me: { name: string } | null;
  onNewGame: () => void;
  /** An online game was created, by a rematch; null when it could not be. */
  onOpened: (gameId: string | null) => void;
  /** The online game nobody had joined was cancelled. */
  onCancelled: () => void;
  /** A kept game opened from the player's list, with what Done does. */
  review: { record: FinishedGame; onDone: () => void } | null;
}): ShownGame {
  const placeholder = useMemo(() => newGame(9), []);
  const { online, lobby, lobbyState } = d;
  const row = online && online.view.kind !== 'loading' ? online.view.row : null;
  // A player who has just joined is not in the lobby yet; look them up once.
  const unknownSeats = [row?.black, row?.white].filter((id) => id && !lobbyState?.nameOf(id)).join(',');
  useEffect(() => {
    if (unknownSeats) void lobby?.refresh();
  }, [unknownSeats, lobby]);
  const record = d.review?.record;
  const reviewed = useMemo(() => {
    const replay = record && replayFinished(record);
    return replay?.ok ? replay.game : null;
  }, [record]);
  if (d.review && reviewed) return reviewGame({ ...d, ...d.review, game: reviewed });
  return online ? onlineGame({ ...d, online, placeholder }) : sessionGame(d);
}
