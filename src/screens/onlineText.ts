// Player-facing wording for the online lobby, the online game and its outcomes.
import type { GameRow } from '../net/api';
import type { LobbyProblem, LobbyState } from '../net/lobby';
import type { ActProblem, MatchView } from '../net/match';
import type { RefusedReason } from '../online/log';
import type { Color, IllegalReason } from '../go/rules';
import { illegalText, scoringText } from '../ui/copy';
import { passTooText } from './gameText';
import { phrase, t } from '../ui/i18n';

const lobbyProblems: Record<LobbyProblem, string> = {
  wrongFamilyCode: phrase('That family code did not match. Please try again.'),
  nameTaken: phrase('Someone already has that name. Please choose another.'),
  gameTaken: phrase('Someone already joined or cancelled this game.'),
  tooManyOpenGames: phrase('You have too many games waiting for someone to join. Open one and cancel it, then try again.'),
  offline: phrase('Could not connect. Check your connection and try again. You can always play offline.'),
  unavailable: phrase('Online play isn’t switched on yet. You can keep playing on this phone.'),
  failed: phrase('Something went wrong. It was reported; please try again.'),
};

const refused: Record<Exclude<RefusedReason, IllegalReason>, string> = {
  notYourTurn: phrase('Wait for your turn.'),
  notScoring: phrase('That only works while counting.'),
  gameOver: phrase('The game has ended.'),
  alreadyAccepted: phrase('You already accepted. Waiting for the other player.'),
  badDeadList: phrase('That is not possible right now.'),
  brokenChain: phrase('That is not possible right now.'),
  hashMismatch: phrase('That is not possible right now.'),
};

export const lobbyProblemText = (p: LobbyProblem) => t(lobbyProblems[p]);

const refusedText = (r: RefusedReason) => (r in refused ? t(refused[r as keyof typeof refused]) : illegalText(r as IllegalReason));

export function actProblemText(p: ActProblem): string {
  switch (p.kind) {
    case 'illegal':
      return refusedText(p.reason);
    case 'stale':
      return t('The other player was quicker. Check the board and try again.');
    case 'offline':
      return t('Could not reach the server. If your move arrived, it shows on the board.');
    case 'stopped':
      return t('This game has stopped.');
    case 'rejected':
      return t('Something went wrong with that move. It was reported.');
  }
}

const otherColor = (c: Color): Color => (c === 'black' ? 'white' : 'black');

/** The status line over an online game, from this phone's seat. */
export function onlineStatus(view: MatchView, s: { error: string; preview: boolean; nameOf: (c: Color) => string }): string {
  if (view.kind === 'loading') return s.error || t('Loading game…');
  if (view.kind === 'unsupported') return t('This game was started with a newer version of the app. Update the app to play it.');
  if (view.kind === 'stopped') {
    return t('This game was stopped because the two phones no longer agree about move {n}. A report was sent so it can be fixed.', {
      n: view.n,
    });
  }
  if (s.error) return s.error;
  const { turn, you, state } = view;
  const other = otherColor(you ?? 'black');
  switch (turn) {
    case 'waiting':
      return t('Waiting for someone to join');
    case 'over':
      return t('Game over');
    case 'scoring':
      if (you && state.accepted[you]) return t('You already accepted. Waiting for the other player.');
      if (you && state.accepted[other]) return t('{name} accepted the count. Check the marks, then Count', { name: s.nameOf(other) });
      return scoringText(state.game);
    case 'theirs':
      return t('Waiting for the other player');
    case 'yours': {
      if (s.preview) return t('Tap again to place the stone');
      const last = state.game.moves[state.game.moves.length - 1];
      if (last?.kind === 'pass') return passTooText({ name: s.nameOf(other) });
      return t('Your turn to play');
    }
  }
}

/** Where a listed game stands, from this phone's side. */
export function lobbyGameText(g: GameRow, me: string, nameOf: (playerId: string | null) => string | undefined): string {
  const seat: Color | null = g.black === me ? 'black' : g.white === me ? 'white' : null;
  switch (g.status) {
    case 'open':
      if (g.created_by === me) {
        const invited = g.invited && nameOf(g.invited);
        return invited ? t('Waiting for {name} to join', { name: invited }) : t('Waiting for someone to join');
      }
      return g.invited === me ? t('Wants to play with you') : t('Open to join');
    case 'playing':
      return g.to_play === seat ? t('Your turn to play') : t('Waiting for the other player');
    case 'scoring':
      return t('Marking dead stones');
    case 'over':
      if (!g.result) return t('Game over');
      return g.result.winner === seat ? t('You win!') : t('{name} wins', { name: nameOf(g[g.result.winner]) ?? t('Opponent') });
    case 'disputed':
      return t('This game has stopped.');
  }
}

/** When a family member was last seen with Play online open. */
export function seenText(online: boolean, lastSeen: string | null | undefined, now: number): string {
  if (online) return t('Online now');
  const minutes = Math.max(1, Math.round((now - Date.parse(lastSeen ?? '')) / 60_000));
  if (minutes < 60) return t('Seen {n} min ago', { n: minutes });
  if (minutes < 60 * 24) return t('Seen {n} h ago', { n: Math.round(minutes / 60) });
  return t('Seen {n} d ago', { n: Math.round(minutes / 60 / 24) });
}

/**
 * What shows beside the other player's card: whether they have the app open, or, while this phone can't
 * reach the server, that it is trying again, since their presence is unknown then. No text before anyone joins.
 */
export function opponentStatus(
  reachable: boolean,
  them: string | null,
  lobby: LobbyState | null,
): { tone: 'online' | 'away' | 'offline'; text: string | null } {
  if (!reachable) return { tone: 'offline', text: t('Offline. Trying again…') };
  if (!them || !lobby) return { tone: 'away', text: null };
  if (lobby.isOnline(them)) return { tone: 'online', text: t('Online now') };
  const seen = lobby.playerOf(them)?.last_seen_at;
  return { tone: 'away', text: seen ? seenText(false, seen, lobby.now()) : null };
}
