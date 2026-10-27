/**
 * KataGo's human-style network (b18c384nbt-humanv0): trained on human games to predict the move a player of a
 * given rank would make. Besides the usual inputs it reads a profile of the game it imagines, 192 numbers that
 * name the players' ranks, the server, the clock and the date. This builds KataGo's profile `rank_<rank>`: a
 * game on KGS in March 2020, both players of that rank, 20 minutes and 5 × 30 s byo-yomi (KataGo's
 * `SGFMetadata::getProfile`, encoded as `fillMetadataRow`).
 */
import type { Looseness, NetReading } from './katago';

export const HUMAN_META = 192;

/** KataGo's inverse rank: 1 is 9 dan, 10 is 1 kyu, 29 is 20 kyu; up to 34 (25 kyu) was seen in training. */
export const inverseRank = (kyu: number) => 9 + kyu;

const DAYS_TO_2020_03_01 = 18322;
const KGS = 2;

export function humanMeta(inverse: number, size: number): Float32Array {
  const row = new Float32Array(HUMAN_META);
  row[0] = row[1] = 1;
  for (let i = 0; i < Math.min(inverse, 34); i++) row[6 + i] = row[40 + i] = 1;
  row[74] = 0.5;
  row[79] = 1;
  row[82] = 0.4 * (Math.log(1200 + 60) - 6.5);
  row[83] = 0.3 * (Math.log(30 + 1) - 3);
  row[84] = 0.5 * (Math.log(5 + 2) - 1.5);
  row[85] = 0.25 * (Math.log(0 + 2) - 1.5);
  row[86] = 0.5 * Math.log((size * size) / 361);
  let period = 7;
  const factor = Math.pow(80000, 1 / 31);
  for (let i = 0; i < 32; i++) {
    const turns = DAYS_TO_2020_03_01 / period;
    row[87 + i * 2] = Math.cos(turns * 2 * Math.PI);
    row[88 + i * 2] = Math.sin(turns * 2 * Math.PI);
    period *= factor;
  }
  row[151 + KGS] = 1;
  return row;
}

/** A level played by the human-style network: the rank it imitates, and how loosely it follows the moves it predicts. */
export interface HumanStyle {
  inverse: number;
  heat: number;
}

/**
 * Every level when the player chooses the human-like bot, on phones that can run the network
 * (`humanNetAvailable`). Levels 1–3 were matched on a desktop to the small network's levels so the ratings
 * hold (see `modules/go-net/README.md`); 4–7 imitate 10 kyu, 5 kyu, 1 kyu and 5 dan. A heat above 1 spreads
 * the choice beyond what a player of the rank would likely play.
 */
const HUMAN_STYLES: Record<number, HumanStyle[]> = {
  9: [
    { inverse: 34, heat: 1.5 },
    { inverse: 34, heat: 1 },
    { inverse: 29, heat: 1 },
    { inverse: 19, heat: 1 },
    { inverse: 14, heat: 1 },
    { inverse: 10, heat: 1 },
    { inverse: 5, heat: 1 },
  ],
  13: [
    { inverse: 34, heat: 1.7 },
    { inverse: 34, heat: 1.3 },
    { inverse: 34, heat: 1 },
    { inverse: 19, heat: 1 },
    { inverse: 14, heat: 1 },
    { inverse: 10, heat: 1 },
    { inverse: 5, heat: 1 },
  ],
  19: [
    { inverse: 34, heat: 1.3 },
    { inverse: 34, heat: 1 },
    { inverse: 31, heat: 1 },
    { inverse: 19, heat: 1 },
    { inverse: 14, heat: 1 },
    { inverse: 10, heat: 1 },
    { inverse: 5, heat: 1 },
  ],
};

export const humanStyleAt = (size: number, level: number): HumanStyle | null => HUMAN_STYLES[size]?.[level - 1] ?? null;

/** How `decide` samples the human network's moves: all but the ones it gives almost no chance. */
export const humanLooseness = (style: HumanStyle): Looseness => ({ heat: style.heat, floor: 0.005 });

/**
 * The human network predicts moves; whether the game is won, settled or lost is the small network's
 * judgement, as KataGo itself plays the human network (`humanSLChosenMoveIgnorePass`).
 */
export const withHumanMoves = (judge: NetReading, human: NetReading): NetReading => ({ ...judge, policy: human.policy });
