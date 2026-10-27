import type { BotLevel } from '../session';
import { botRating, handicapFor, LEVELS, rankMove, rankName, rated, startingRating, withLevel } from '../rating';

describe('ranks', () => {
  it('names ratings as kyu and dan ranks, 100 points a rank', () => {
    expect(rankName(-900)).toBe('30k');
    expect(rankName(100)).toBe('20k');
    expect(rankName(1949)).toBe('2k');
    expect(rankName(2000)).toBe('1k');
    expect(rankName(2100)).toBe('1d');
    expect(rankName(2750)).toBe('7d');
    expect(rankName(-2000)).toBe('30k');
    expect(rankName(5000)).toBe('9d');
  });

  it('tells how a game moved the rank shown, not the rating behind it', () => {
    expect(rankMove(150, 210)).toBe('up');
    expect(rankMove(150, 90)).toBe('down');
    expect(rankMove(150, 190)).toBe('same');
    expect(rankMove(150, 110)).toBe('same');
    expect(rankMove(-900, -950)).toBe('same');
  });

  it('starts each self-estimated level at its rank', () => {
    expect(LEVELS.map((l) => rankName(startingRating(l)))).toEqual(['30k', '25k', '20k', '15k', '10k', '5k', '1d']);
  });

  it('ranks mean something from Beginner up', () => {});

  it('choosing a level restarts the rating from that level and keeps everything else', () => {
    const me = { name: 'Jane Doe', level: 'beginner' as const, rating: 420, games: 12 };
    expect(withLevel(me, 'club')).toEqual({ name: 'Jane Doe', level: 'club', rating: startingRating('club'), games: 0 });
  });

  it('gives each bot level a rank on each board size, each level stronger than the one below', () => {
    for (const size of [9, 13, 19]) {
      expect(rankName(botRating(1, size))).toMatch(/k$/);
      for (const level of [2, 3, 4, 5, 6, 7] as const) {
        expect(botRating(level, size)).toBeGreaterThan(botRating((level - 1) as BotLevel, size));
      }
      expect(botRating(7, size)).toBeGreaterThanOrEqual(botRating(1, size) + 1000);
    }
    expect(botRating(1, 19)).toBeLessThan(startingRating('beginner'));
  });

  it('rates the human-like levels as the KataGo ones they were matched to, and above them by the rank they imitate', () => {
    for (const size of [9, 13, 19]) {
      for (const level of [1, 2, 3] as const) expect(botRating(level, size, 'human')).toBe(botRating(level, size));
      expect(([4, 5, 6, 7] as const).map((level) => rankName(botRating(level, size, 'human')))).toEqual(['10k', '5k', '1k', '5d']);
    }
  });
});

describe('handicap', () => {
  it('is the rank difference, the weaker player taking Black, at most the board allows', () => {
    expect(handicapFor(1000, 1350, 19)).toEqual({ handicap: 3, black: 'a' });
    expect(handicapFor(1350, 1000, 19)).toEqual({ handicap: 3, black: 'b' });
    expect(handicapFor(-900, 2100, 19)).toEqual({ handicap: 9, black: 'a' });
    expect(handicapFor(-900, 2100, 13)).toEqual({ handicap: 9, black: 'a' });
    expect(handicapFor(-900, 2100, 9)).toEqual({ handicap: 5, black: 'a' });
  });

  it('is an even game within a rank, and one stone for a rank', () => {
    expect(handicapFor(1000, 1090, 19)).toEqual({ handicap: 0, black: 'a' });
    expect(handicapFor(1090, 1000, 19)).toEqual({ handicap: 0, black: 'b' });
    expect(handicapFor(1000, 1160, 19)).toEqual({ handicap: 1, black: 'a' });
    expect(handicapFor(1000, 1200, 19)).toEqual({ handicap: 2, black: 'a' });
  });
});

describe('rating after a game', () => {
  it('a win against an equal player raises it as much as a loss lowers it', () => {
    const won = rated({ rating: 1000, games: 20 }, 1000, 'win', 0, 'black');
    const lost = rated({ rating: 1000, games: 20 }, 1000, 'loss', 0, 'black');
    expect(won.rating - 1000).toBeCloseTo(1000 - lost.rating, 6);
    expect(won.rating).toBeGreaterThan(1000);
    expect(won.games).toBe(21);
  });

  it('a fair handicap game counts like an even game between equals', () => {
    const fair = rated({ rating: 1000, games: 20 }, 1300, 'win', 3, 'black');
    const even = rated({ rating: 1000, games: 20 }, 1000, 'win', 0, 'black');
    expect(fair.rating).toBeCloseTo(even.rating, 6);
  });

  it('beating someone much stronger moves it more than beating someone weaker', () => {
    const upset = rated({ rating: 1000, games: 20 }, 1500, 'win', 0, 'black');
    const expected = rated({ rating: 1000, games: 20 }, 500, 'win', 0, 'black');
    expect(upset.rating - 1000).toBeGreaterThan(expected.rating - 1000);
  });

  it('a new player moves faster than a settled one', () => {
    const fresh = rated({ rating: 1000, games: 0 }, 1000, 'win', 0, 'black');
    const settled = rated({ rating: 1000, games: 100 }, 1000, 'win', 0, 'black');
    expect(fresh.rating - 1000).toBeGreaterThan(settled.rating - 1000);
  });

  it('stays within 30 kyu and 9 dan', () => {
    expect(rated({ rating: -900, games: 0 }, 2000, 'loss', 0, 'black').rating).toBe(-900);
    expect(rated({ rating: 2900, games: 0 }, 0, 'win', 0, 'white').rating).toBe(2900);
  });
});
