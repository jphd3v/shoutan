import type { FinishedGame } from '../go/finished';
import type { Moment, Suggestion } from '../go/guide';
import type { GroupStatus } from '../go/netHints';
import { Level, rankMove, rankName, RankMove } from '../go/rating';
import { EMPTY, GameState, IllegalReason } from '../go/rules';
import { language, phrase, t } from './i18n';

/** Half points read as ½, the way Go scores are usually written. */
export function points(n: number): string {
  const whole = Math.floor(n);
  return n - whole === 0.5 ? `${whole === 0 ? '' : whole}½` : `${n}`;
}

const levels: Record<Level, string> = {
  never: phrase('I’ve never played'),
  basics: phrase('I know the basics'),
  beginner: phrase('Beginner'),
  casual: phrase('I play now and then'),
  intermediate: phrase('Intermediate'),
  club: phrase('Club player'),
  dan: phrase('Strong (dan)'),
};
/** How a player describes their level in Options. */
export const levelText = (l: Level) => t(levels[l]);

/**
 * What to do while the dead stones are reviewed; a board with no stones has nothing to mark. Playing
 * on is always the safe answer to a doubt: under area scoring, capturing in your own area costs nothing.
 */
export const scoringText = (game: GameState) =>
  !game.board.some((v) => v !== EMPTY)
    ? t('No stones to take off. Tap Count to count the score.')
    : game.unsure?.size
      ? t('Tap a ? group to decide, or keep playing to settle it.')
      : !game.dead.size
        ? t('No stones marked. Tap a group that can’t escape, or tap Count.')
        : t('Check the ✕ stones, then tap Count.');

/** A handicap choice, e.g. "None", "1 stone" or "4 stones". */
export const handicapText = (stones: number) => (stones === 1 ? t('1 stone') : stones ? t('{n} stones', { n: stones }) : t('None'));

/** What the marks on the board mean while the dead stones are marked and while it counts. */
export const countLegend = {
  dead: () => t('Taken off'),
  unsure: () => t('Might escape'),
  point: (c: 'black' | 'white') => (c === 'black' ? t('Black points') : t('White points')),
  shared: () => t('½ each'),
  komi: (k: number) => t('+{n} komi', { n: points(k) }),
};

const illegal: Record<IllegalReason, string> = {
  occupied: phrase('There’s already a stone there.'),
  suicide: phrase('That stone would be captured right away. Try another spot.'),
  ko: phrase('Not yet! That would just undo the last capture. Play somewhere else first.'),
  outOfBounds: phrase('That’s off the board.'),
  notPlaying: phrase('The game has ended.'),
};
export const illegalText = (r: IllegalReason) => t(illegal[r]);

export const howToPlay = [
  {
    title: phrase('Take turns'),
    body: phrase('Place one stone where the lines cross. Black goes first. Stones never move once placed.'),
    diagram: ['.....', '.X...', '...O.', '..X..', '.....'],
  },
  {
    title: phrase('Surround to capture'),
    body: phrase('Stones need empty points next to them. Fill the last empty point around a stone and it’s captured.'),
    diagram: ['.....', '..X..', '.XoX.', '..X..', '.....'],
  },
  {
    title: phrase('Claim space'),
    body: phrase('Your score is your stones plus the empty points you fence in. White gets 7½ extra points for going second.'),
    diagram: ['bbX..', 'bbX..', 'XXX..', '...OO', '...Ow'],
  },
  {
    title: phrase('Finish together'),
    body: phrase(
      'When there’s nothing left to gain, both players pass. Stones that can’t escape are taken off, the board counts the score, and the higher score wins. Not sure a group can escape? Keep playing and capture it: it costs no points.',
    ),
    diagram: null,
  },
] as const;

/** Deeper lessons behind "Going further" in the rules. `l` marks a liberty. */
export const goingFurther = [
  {
    title: phrase('Liberties'),
    body: phrase(
      'The empty points right next to a group are its liberties. Stones joined along the lines share them, so they are stronger together.',
    ),
    diagram: ['.l...', 'lXl..', 'lXl..', '.l...', '.....'],
  },
  {
    title: phrase('Atari'),
    body: phrase(
      'A group with only one liberty left is in atari: it can be captured on the next move. Add a stone there to escape, or capture something first.',
    ),
    diagram: ['.....', '..X..', '.XOl.', '..X..', '.....'],
  },
  {
    title: phrase('Ko'),
    body: phrase(
      'If one stone could be captured straight back, the other player must play somewhere else first. That stops the same capture repeating forever.',
    ),
    diagram: ['.....', '.XO..', 'X.XO.', '.XO..', '.....'],
  },
  {
    title: phrase('Two eyes live'),
    body: phrase('A group with two separate holes inside, called eyes, can never be captured: the other player can’t fill both at once.'),
    diagram: ['.....', 'XXXXX', 'X.X.X', 'XXXXX', '.....'],
  },
  {
    title: phrase('Start in the corners'),
    body: phrase('Corners and edges need the fewest stones to fence in space, so most games begin there before moving to the middle.'),
    diagram: ['.....', '.....', '...X.', '..X..', '.X...'],
  },
  {
    title: phrase('The Coach and hints'),
    body: phrase(
      'Under the buttons, the Coach shows the strongest move as a ghost stone on every turn, says what your last move cost, outlines stones in danger and explains ko; hold any stone to see its liberties. Tick Liberties to see every group’s liberties as small circles in its colour, with a red rim on a last one.',
    ),
    diagram: null,
  },
] as const;

/** Who a sentence is about: the human or the bot in a game against it, a colour face to face, or an online player. */
export type Who = 'you' | 'bot' | 'black' | 'white' | { name: string };

/** A line under the result; `move`, with `spoken` for screen readers, when a rated game moved the rank or left it. */
export interface ResultNote {
  text: string;
  move?: RankMove;
  spoken?: string;
}

/** The player's rank after a game, and with `before`, the rating a rated game started from, how it moved. */
export function rankNote(rating: number, before: number | null): ResultNote {
  const rank = rankName(rating);
  const text = t('Your rank: {rank}', { rank });
  if (before === null) return { text };
  const move = rankMove(before, rating);
  const was = { rank, before: rankName(before) };
  const spoken =
    move === 'same'
      ? t('Your rank: {rank}, unchanged', { rank })
      : move === 'up'
        ? t('Your rank: {rank}, up from {before}', was)
        : t('Your rank: {rank}, down from {before}', was);
  return { text, move, spoken };
}

/** What a move just did, in words: a ko taken. */
export function momentText(_m: Moment): string {
  return t('Ko! It can’t be taken back right away');
}

/** Why a move is good, in plain words, when the rules see a capture, an escape or an atari in it. */
function reasonText(s: Suggestion): string {
  const many = s.count > 1;
  if (s.kind === 'capture') return many ? t('You can capture {n} stones.', { n: s.count }) : t('You can capture a stone.');
  if (s.kind === 'escape')
    return many ? t('Your stones are about to be captured. Save them!') : t('Your stone is about to be captured. Save it!');
  return many ? t('You can leave {n} stones with one liberty.', { n: s.count }) : t('You can leave a stone with one liberty.');
}

/**
 * The Guide's line of advice. `ideas` holds one entry per line of an ideas advice, with the point
 * of its ghost stone, so tapping a line can show where it means; it is empty for other advice.
 * `sentence` is the line without its number, for a screen that shows the number on its own.
 */
export interface AdviceText {
  text: string;
  ideas: { text: string; sentence: string; point: number }[];
  /** A sentence before the ideas; tapping it shows `point`, when it has one. */
  note?: { text: string; point?: number };
}

/** The Coach's ghost stones, for screen readers: the strongest move, then the one nearly as good. */
export const strongestLabel = (i: number) => (i === 0 ? t('Strongest move') : t('Nearly as good'));

/**
 * The Coach's advice: the strongest moves, after what the player's last move cost when it cost much. A move
 * the rules see as a capture, an escape or an atari (`reasons`, from `suggestionsFor`) also says so.
 */
export function hintText(
  moves: readonly number[],
  cost: { lost: number; better: number } | null,
  reasons: readonly Suggestion[] = [],
): AdviceText {
  const note = cost ? costNote(moves, cost) : undefined;
  if (!moves.length) return { text: t('Nothing big is left to play. Passing is fine now.'), ideas: [], note };
  const sentences = moves.map((point, i) => {
    const base = i === 0 ? t('The strongest move here.') : t('Nearly as good.');
    const reason = reasons.find((r) => r.point === point);
    return reason ? `${base} ${reasonText(reason)}` : base;
  });
  const lines = sentences.length > 1 ? sentences.map((s, i) => `${i + 1}. ${s}`) : sentences;
  return { text: lines.join('\n'), ideas: moves.map((point, i) => ({ text: lines[i], sentence: sentences[i], point })), note };
}

/**
 * What the last move cost. When the stronger move is still one of the ideas, the note names that idea
 * rather than showing the same point again, which would light up two rows for one stone.
 */
function costNote(moves: readonly number[], { lost: n, better }: { lost: number; better: number }): NonNullable<AdviceText['note']> {
  const still = moves.indexOf(better);
  if (still < 0) return { text: t('Your last move cost about {n} points. Tap to see what was stronger.', { n }), point: better };
  if (moves.length === 1) return { text: t('Your last move cost about {n} points. The move shown was stronger, and still is.', { n }) };
  return {
    text:
      still === 0
        ? t('Your last move cost about {n} points. Move 1 was stronger, and still is.', { n })
        : t('Your last move cost about {n} points. Move 2 was stronger, and still is.', { n }),
  };
}

/** What each outline of the Coach means, for the legend beside the board. */
export function outlineText(s: GroupStatus): string {
  switch (s) {
    case 'urgent':
      return t('Your stones that die unless you answer now');
    case 'lost':
      return t('Stones likely lost');
    case 'weak':
      return t('Weak stones: they could still live or die');
  }
}

const gameDate = (at: string) => new Date(at).toLocaleDateString(language(), { day: 'numeric', month: 'short', year: 'numeric' });

/** A game in the player's list that a newer version of the app saved: only its date can be shown. */
export const newerGameText = (endedAt: string) => ({
  title: t('Saved with a newer version of the app'),
  result: t('Update the app to see this game.'),
  details: gameDate(endedAt),
});

/** A finished game in the player's list: who it was against, how it ended, and its setup and date. */
export function finishedText(
  g: FinishedGame,
  nameOf: (playerId: string) => string | undefined,
  rated: number | null,
): { title: string; result: string; details: string } {
  const { meta, core } = g;
  const title =
    meta.mode === 'bot'
      ? t('Bot')
      : meta.mode === 'face_to_face'
        ? t('Face to face')
        : ((meta.opponent && nameOf(meta.opponent)) ?? t('Opponent'));
  const { winner, margin } = core.result;
  const outcome = meta.you ? (winner === meta.you ? t('You won') : t('You lost')) : winner === 'black' ? t('Black won') : t('White won');
  const how = margin === null ? t('by resignation') : t('by {n} points', { n: points(margin) });
  const date = gameDate(g.endedAt);
  const details = [
    ...(meta.mode === 'online' ? [t('Online')] : []),
    `${core.size}×${core.size}`,
    ...(meta.handicap ? [handicapText(meta.handicap)] : []),
    date,
    ...(rated === null ? [] : [`${rated >= 0 ? '+' : '−'}${Math.abs(Math.round(rated))}`]),
    ...(meta.coached ? [t('With the Coach')] : []),
    ...(meta.tookBack ? [t('Moves taken back')] : []),
  ].join(' · ');
  return { title, result: `${outcome} ${how}`, details };
}
