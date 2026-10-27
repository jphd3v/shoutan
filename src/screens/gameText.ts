// Player-facing wording about the players of the game on screen, offline and online alike, and the status
// line of the game on this phone. A sentence that names a player has one key per kind of name, because the
// other languages inflect names.
import type { Color, GameState } from '../go/rules';
import { aiColor, isAiTurn, Opponent, Session } from '../go/session';
import { illegalText, points, scoringText, Who } from '../ui/copy';
import { t } from '../ui/i18n';

/** Who a player of the game on this phone is: the bot or the human against the bot, otherwise the colour. */
export const whoIs = (s: Session, c: Color): Who => {
  const ai = aiColor(s);
  return ai ? (c === ai ? 'bot' : 'you') : c;
};

export function passedText(who: Who): string {
  if (typeof who === 'object') return t('{name} passed', { name: who.name });
  return { bot: t('Bot passed'), you: t('You passed'), black: t('Black passed'), white: t('White passed') }[who];
}

export function passTooText(who: Who): string {
  if (typeof who === 'object') return t('{name} passed · pass too to finish', { name: who.name });
  return {
    bot: t('Bot passed · pass too to finish'),
    you: t('You passed · pass too to finish'),
    black: t('Black passed · pass too to finish'),
    white: t('White passed · pass too to finish'),
  }[who];
}

/** What resigning would mean for the player who would resign. */
export function resignWarningText(who: Who): string {
  if (typeof who === 'object') return t('Resign? You will lose this game.');
  return {
    bot: t('Resign? The bot will lose this game.'),
    you: t('Resign? You will lose this game.'),
    black: t('Resign? Black will lose this game.'),
    white: t('Resign? White will lose this game.'),
  }[who];
}

/** The result card's title and subtitle for a finished game, naming its players with `whoOf`. */
export function resultText(game: GameState, whoOf: (c: Color) => Who): { title: string; subtitle: string } {
  const r = game.result;
  if (!r) return { title: '', subtitle: '' };
  const winner = whoOf(r.winner);
  const title =
    typeof winner === 'object'
      ? t('{name} wins', { name: winner.name })
      : { bot: t('Bot wins'), you: t('You win!'), black: t('Black wins!'), white: t('White wins!') }[winner];
  if (r.reason !== 'resignation') return { title, subtitle: t('by {n} points', { n: points(r.margin) }) };
  const loser = whoOf(r.winner === 'black' ? 'white' : 'black');
  const subtitle =
    typeof loser === 'object'
      ? t('{name} resigned', { name: loser.name })
      : { bot: t('Bot resigned'), you: t('You resigned'), black: t('Black resigned'), white: t('White resigned') }[loser];
  return { title, subtitle };
}

/** The status line of the game on this phone; face to face each end speaks to its own player. */
export function statusText(s: Session, preview: number | null, facing: boolean = false): string {
  const { game } = s;
  if (game.phase === 'over') return t('Game over');
  if (game.phase === 'scoring') return s.guessing ? t('Looking for stones that can’t escape…') : scoringText(game);
  if (isAiTurn(s)) return t('Bot is thinking');
  if (s.lastIllegal) return illegalText(s.lastIllegal);
  if (preview !== null) return t('Tap again to place the stone');
  const last = game.moves[game.moves.length - 1];
  if (last?.kind === 'pass') return passTooText(whoIs(s, last.color));
  if (facing) return t('Your turn to play');
  const turn = whoIs(s, game.toPlay);
  return turn === 'bot'
    ? t('Bot is thinking')
    : turn === 'you'
      ? t('Your turn to play')
      : turn === 'black'
        ? t('Black’s turn to play')
        : t('White’s turn to play');
}

/** A game in a few words: "13×13 · Bot · Move 4"; an online game goes without the opponent. */
export function gameSummary(size: number, opponent: Opponent | null, moves: number, against?: string): string {
  const kind = against || (opponent === 'ai' ? t('Bot') : opponent === 'human' ? t('Face to face') : null);
  return [`${size}×${size}`, kind, moves > 0 ? t('Move {n}', { n: moves }) : null].filter(Boolean).join(' · ');
}
