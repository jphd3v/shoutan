/**
 * Player strength on the European (EGF) scale: 100 points a rank, 100 = 20 kyu, 2100 = 1 dan.
 * A handicap stone is worth about a rank, so the handicap between two players is their rank
 * difference. After a game the rating moves Elo-style, with the handicap counted in.
 */
import type { Color } from './rules';
import type { BotLevel } from './session';
import { maxHandicap } from './rules';

/** What a new player says about themselves, weakest first. */
export const LEVELS = ['never', 'basics', 'beginner', 'casual', 'intermediate', 'club', 'dan'] as const;
export type Level = (typeof LEVELS)[number];

// Mid-rank, so one close game does not change the rank shown.
const START: Record<Level, number> = {
  never: -900, // 30k
  basics: -350, // 25k
  beginner: 150, // 20k
  casual: 650, // 15k
  intermediate: 1150, // 10k
  club: 1650, // 5k
  dan: 2150, // 1d
};

export const MIN_RATING = -900;
export const MAX_RATING = 2900;

export const startingRating = (level: Level) => START[level];

/** A player who says their level has changed starts again from it, with a fresh rating that moves fast. */
export const withLevel = <T extends { level: Level } & Rating>(me: T, level: Level): T => ({
  ...me,
  level,
  rating: startingRating(level),
  games: 0,
});

/**
 * Each bot level's strength per board size, so the setup can offer the level that suits a player and
 * give or take stones. Level 7 (the network's favourite move) is an estimate, not yet measured against
 * people; the levels below are spaced by how often each beat the level below in matches
 * (`modules/go-net/README.md`).
 */
const BOT_RATING: Record<number, readonly number[]> = {
  9: [300, 650, 900, 1150, 1250, 1450, 1800],
  13: [150, 400, 600, 1000, 1200, 1500, 1800],
  19: [-50, 250, 500, 800, 1150, 1450, 1800],
};

/**
 * Which network the bot plays: `human`, KataGo's human-style network imitating a rank, or `kata`, the small
 * standard network.
 */
export type BotNet = 'human' | 'kata';
export const BOT_NETS: readonly BotNet[] = ['human', 'kata'];

/**
 * The human-like levels 1–3 were matched to the KataGo levels they stood in for, so they share their ratings;
 * 4–7 are rated, for now, by the rank they imitate (10k, 5k, 1k, 5d), not yet measured.
 */
const HUMAN_RATING_ABOVE = [1150, 1650, 2050, 2550];

export const botRating = (level: BotLevel, size: number, net: BotNet = 'kata') =>
  net === 'human' && level > 3 ? HUMAN_RATING_ABOVE[level - 4] : (BOT_RATING[size] ?? BOT_RATING[9])[level - 1];

export function rankName(rating: number): string {
  const r = Math.min(MAX_RATING, Math.max(MIN_RATING, rating));
  // 2100 and up is dan; below, each 100 points down is one more kyu from 1k at 2000.
  if (r >= 2100) return `${Math.min(9, Math.floor((r - 2100) / 100) + 1)}d`;
  return `${Math.min(30, Math.floor((2099 - r) / 100) + 1)}k`;
}

export type RankMove = 'up' | 'down' | 'same';

/** How a game moved the rank shown: a rating that moves within its rank leaves it the same. */
export function rankMove(before: number, after: number): RankMove {
  if (rankName(before) === rankName(after)) return 'same';
  return after > before ? 'up' : 'down';
}

/** Ranks counted from 30 kyu (0) upward, matching `rankName`. */
const rankIndex = (rating: number) => {
  const name = rankName(rating);
  const n = Number(name.slice(0, -1));
  return name.endsWith('d') ? 29 + n : 30 - n;
};

/**
 * Stones for a game between players `a` and `b` on this board: the difference between their ranks
 * as shown, the weaker taking Black, at most the board's maximum. Within a rank the game is even;
 * one rank apart is one stone, Black playing first with ½ komi.
 */
export function handicapFor(a: number, b: number, size: number): { handicap: number; black: 'a' | 'b' } {
  const handicap = Math.min(maxHandicap(size), Math.abs(rankIndex(a) - rankIndex(b)));
  return { handicap, black: a <= b ? 'a' : 'b' };
}

export interface Rating {
  rating: number;
  /** Rated games so far; new players' ratings move faster. */
  games: number;
}

/**
 * The rating after one game against an opponent rated `opponent`. `handicap` stones (taken by
 * Black) count as a rank each, so a fair handicap game is like an even game between equals.
 */
export function rated(me: Rating, opponent: number, result: 'win' | 'loss', handicap: number, myColor: Color): Rating {
  const advantage = handicap * 100 * (myColor === 'black' ? 1 : -1);
  const expected = 1 / (1 + Math.exp(-(me.rating + advantage - opponent) / 200));
  const k = me.games < 10 ? 120 : me.games < 40 ? 60 : 30;
  const next = me.rating + k * ((result === 'win' ? 1 : 0) - expected);
  // Whole numbers, as finished-game records keep them.
  return { rating: Math.round(Math.min(MAX_RATING, Math.max(MIN_RATING, next))), games: me.games + 1 };
}
