import { FinishedGame, finishedGame, FinishedContext, instant, isNewer, keepUnknown, readFinished, replayFinished } from '../finished';
import {
  acceptScore,
  EMPTY,
  GameState,
  handicapPoints,
  legalPoints,
  newGame,
  pass,
  play,
  pointFromName,
  resign,
  resumePlay,
  RULES_VERSION,
  setDead,
} from '../rules';
import { PASS } from '../saved';
import { playAll } from './helpers';
import { broken, extended, newer, readable } from './records';

const p = (name: string) => pointFromName(9, name);
const T0 = '2026-10-18T10:00:00.000Z';
const T1 = '2026-10-18T10:20:00.000Z';
const ID = '0a6f3c1e-2b4d-4c8a-9e1f-3d5b7a9c1eff';
const ME = '3b9d5e7f-1a2c-4d6e-8f0a-2b4c6d8e0f11';
const ctx: FinishedContext = { id: ID, mode: 'bot', rules: RULES_VERSION, startedAt: T0, endedAt: T1, you: 'black' };
const game = (x: unknown) => {
  const g = readFinished(x);
  if (!g || isNewer(g)) throw new Error('not a readable record');
  return g;
};

/** Black's wall on the fifth column and a lone White stone inside Black's area, which is dead. */
function counted(): GameState {
  let g = playAll(newGame(9), 'E1', 'B2', 'E2', 'A1', 'E3', 'H8', 'E4', 'J9', 'E5', 'A9', 'E6', 'B8', 'E7', 'C9', 'E8', 'D9', 'E9', 'A3');
  g = pass(pass(g));
  g = setDead(g, [p('H8'), p('J9')]);
  return acceptScore(g);
}

describe('writing a finished game', () => {
  it('a game still on has no record', () => {
    expect(finishedGame(playAll(newGame(9), 'E5'), ctx)).toBeNull();
  });

  it('keeps the game in the core and what the app knows about it in meta', () => {
    const g = counted();
    const rating = { before: 150, after: 210, opponent: 750 };
    const f = finishedGame(g, { ...ctx, rating })!;
    expect(f).toEqual({
      format: 1,
      id: ID,
      startedAt: T0,
      endedAt: T1,
      core: {
        rules: RULES_VERSION,
        size: 9,
        komi: 7.5,
        setup: { black: [], white: [] },
        first: 'black',
        moves: expect.any(Array),
        dead: [p('J9'), p('H8')].sort((a, b) => a - b),
        result: { winner: 'black', reason: 'score', margin: g.result!.reason === 'score' ? g.result!.margin : -1 },
      },
      meta: { mode: 'bot', you: 'black', handicap: 0, rating },
    });
    expect(f.core.moves.slice(-2)).toEqual([PASS, PASS]);
  });

  it('a resignation has no margin, no dead stones and no resign move', () => {
    const f = finishedGame(resign(playAll(newGame(9), 'E5', 'C3'), 'black'), ctx)!;
    expect(f.core).toMatchObject({ result: { winner: 'white', reason: 'resign', margin: null }, moves: [p('E5'), p('C3')], dead: [] });
  });

  it('writes handicap stones out, with White to move first', () => {
    const f = finishedGame(resign(newGame(13, undefined, 3), 'white'), { ...ctx, mode: 'face_to_face', you: null })!;
    expect(f.core).toMatchObject({ setup: { black: handicapPoints(13, 3).sort((a, b) => a - b), white: [] }, first: 'white', komi: 3.5 });
    expect(f.meta).toEqual({ mode: 'face_to_face', you: null, handicap: 3 });
  });

  it('one stone is Black first on an empty board with half a point of komi', () => {
    const f = finishedGame(resign(newGame(9, undefined, 1), 'white'), ctx)!;
    expect(f.core).toMatchObject({ setup: { black: [], white: [] }, first: 'black', komi: 0.5 });
    expect(f.meta.handicap).toBe(1);
  });

  it('an online game names the server game, the opponent and its own rules version', () => {
    const online = '5d2e8f1a-3c4b-4a6d-8e9f-0a1b2c3d4e06';
    const peer = '7f1c2a9e-4b3d-4e5f-8a6b-1c2d3e4f5a6b';
    const f = finishedGame(counted(), { ...ctx, mode: 'online', rules: 1, player: ME, onlineGame: online, opponent: peer })!;
    expect(f.meta).toMatchObject({ player: ME, mode: 'online', onlineGame: online, opponent: peer });
    expect(f.core.rules).toBe(1);
  });

  it('names the account the phone was signed in to, and no one signed out', () => {
    expect(finishedGame(counted(), { ...ctx, player: ME })!.meta.player).toBe(ME);
    expect(finishedGame(counted(), { ...ctx, player: null })!.meta).not.toHaveProperty('player');
    expect(finishedGame(counted(), ctx)!.meta).not.toHaveProperty('player');
  });

  it('a game has no length limit', () => {
    let g = newGame(9);
    for (let i = 0; i < 1600; i++) g = resumePlay(pass(pass(g)));
    const f = finishedGame(resign(playAll(g, 'E5'), 'white'), ctx)!;
    expect(f.core.moves.length).toBeGreaterThan(3000);
    expect(game(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(replayFinished(f).ok).toBe(true);
  });

  it('reads times as the server writes them, microseconds and offset included', () => {
    expect(instant('2026-10-21T10:00:00.123456+00:00')).toBeCloseTo(Date.parse('2026-10-21T10:00:00.123Z') + 0.456, 6);
    expect(instant('2026-10-21T10:00:00-01:30')).toBe(Date.parse('2026-10-21T11:30:00Z'));
    expect(instant('2024-02-29T00:00:00Z')).toBe(Date.parse('2024-02-29T00:00:00Z'));
    expect([instant('2023-02-29T00:00:00Z'), instant('2026-10-21'), instant('0050-01-01T00:00:00Z'), instant(1)]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('writes times in UTC to the millisecond, whatever form they came in', () => {
    const f = finishedGame(counted(), { ...ctx, startedAt: '2026-10-18T11:00:00.123456+01:00', endedAt: '2026-10-18T10:20:00.5Z' })!;
    expect([f.startedAt, f.endedAt]).toEqual(['2026-10-18T10:00:00.123Z', '2026-10-18T10:20:00.500Z']);
    expect(game(f)).toEqual(f);
  });

  it('writes any time the way toISOString does, whatever zone it came in', () => {
    let seed = 3;
    const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    for (let n = 0; n < 3000; n++) {
      // Leap days, year ends and the last millisecond of a day come up often.
      const [y, mo] = [1970 + next(1030), next(12) + 1];
      const d = next(3) ? next(28) + 1 : mo === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : 30;
      const [h, mi, sec, ms] = next(3) ? [next(24), next(60), next(60), next(1000)] : [23, 59, 59, 999];
      const [sign, oh, om] = [next(2) ? '+' : '-', next(15), next(4) * 15];
      const at = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(sec)}.${pad(ms, 3)}${sign}${pad(oh)}:${pad(om)}`;
      const f = finishedGame(resign(newGame(9), 'black'), { ...ctx, startedAt: null, endedAt: at })!;
      expect(f.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Date.parse(f.endedAt)).toBe(Date.UTC(y, mo - 1, d, h, mi, sec, ms) - (sign === '+' ? 1 : -1) * (oh * 60 + om) * 60000);
    }
  });

  it('writes handicap stones in ascending order and ratings as whole numbers', () => {
    const f = finishedGame(resign(newGame(19, undefined, 9), 'white'), {
      ...ctx,
      rating: { before: 150.6, after: 212.4, opponent: 749.5 },
    })!;
    expect(f.core.setup.black).toEqual([...handicapPoints(19, 9)].sort((a, b) => a - b));
    expect(f.meta.rating).toEqual({ before: 151, after: 212, opponent: 750 });
    expect(game(f)).toEqual(f);
  });

  it('a game that ended before its first move starts when it ended', () => {
    expect(finishedGame(resign(newGame(9), 'black'), { ...ctx, startedAt: null })!.startedAt).toBe(T1);
  });

  it('a clock set back during the game still gives a record that reads: it starts when it ended', () => {
    const f = finishedGame(resign(newGame(9), 'black'), { ...ctx, startedAt: T1, endedAt: T0 })!;
    expect([f.startedAt, f.endedAt]).toEqual([T0, T0]);
    expect(game(f)).toEqual(f);
  });

  it('every game played to its end reads back as written and replays to its result', () => {
    // Seeded, so a failure names the same game every run.
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)];
    const online = '5d2e8f1a-3c4b-4a6d-8e9f-0a1b2c3d4e06';
    const peer = '7f1c2a9e-4b3d-4e5f-8a6b-1c2d3e4f5a6b';
    const ways: FinishedContext[] = [
      ctx,
      { ...ctx, mode: 'face_to_face', you: null },
      { ...ctx, mode: 'online', player: ME, onlineGame: online, opponent: peer, you: 'white' },
      { ...ctx, player: ME },
      { ...ctx, rating: { before: 150, after: 212.40000000000001, opponent: 750 } },
    ];
    const seen = new Set<string>();
    for (let n = 0; n < 24; n++) {
      const size = pick([9, 13, 19]);
      const way = ways[n % ways.length];
      let g = newGame(size, undefined, pick([0, 0, 1, 2, 5]));
      let resumes = 0;
      while (g.phase !== 'over') {
        if (g.phase === 'scoring') {
          if (resumes < 1 && random() < 0.3) {
            resumes++;
            seen.add('resumed');
            g = resumePlay(g);
          } else {
            const stones = g.board.flatMap((s, i) => (s !== EMPTY && random() < 0.2 ? [i] : []));
            g = acceptScore(setDead(g, stones));
          }
        } else if (g.moves.length > 40 + size * 2 || random() < 0.03) {
          g = random() < 0.4 ? resign(g, g.toPlay) : pass(g);
        } else {
          const legal = legalPoints(g);
          const r = legal.length && random() > 0.05 ? play(g, pick(legal)) : null;
          g = r?.ok ? r.state : pass(g);
        }
      }
      const f = finishedGame(g, way)!;
      seen.add(f.core.result.reason).add(f.core.setup.black.length ? 'handicap' : 'even');
      expect(game(JSON.parse(JSON.stringify(f)))).toEqual(f);
      const replay = replayFinished(f);
      if (!replay.ok) throw new Error(`game ${n}: ${replay.problem}`);
      expect(replay.game.result).toEqual(g.result);
      expect(replay.game.board).toEqual(g.board);
    }
    expect([...seen].sort()).toEqual(['even', 'handicap', 'resign', 'resumed', 'score']);
  });

  it('what it writes reads back the same and replays to the same result', () => {
    for (const g of [counted(), resign(playAll(newGame(13, undefined, 4), 'C3', 'F11'), 'black')]) {
      const f = finishedGame(g, ctx)!;
      expect(game(JSON.parse(JSON.stringify(f)))).toEqual(f);
      const replay = replayFinished(f);
      expect(replay.ok && replay.game.result).toEqual(g.result);
      expect(replay.ok && replay.game.board).toEqual(g.board);
    }
  });
});

describe('golden records', () => {
  it.each([...readable(), ...extended()])('%s reads, replays and gives its stored result', (_, record) => {
    const f = game(record);
    const replay = replayFinished(f);
    if (!replay.ok) throw new Error(replay.problem);
    const r = replay.game.result!;
    expect(r.winner).toBe(f.core.result.winner);
    expect(r.reason === 'score' ? r.margin : null).toBe(f.core.result.margin);
    expect(replay.game.moves.filter((m) => m.kind !== 'resign')).toHaveLength(f.core.moves.length);
  });

  it('covers handicap, one stone, scored, resigned and resumed games', () => {
    const games = readable().map(([, r]) => game(r));
    expect(games.some((g) => g.core.setup.black.length > 0 && g.core.result.reason === 'score')).toBe(true);
    expect(games.some((g) => g.core.setup.black.length > 0 && g.core.result.reason === 'resign')).toBe(true);
    expect(games.some((g) => g.meta.handicap === 1)).toBe(true);
    expect(games.some((g) => g.meta.player && g.meta.mode !== 'online')).toBe(true);
    expect(games.some((g) => !g.meta.player)).toBe(true);
    expect(games.some((g) => g.core.moves.indexOf(PASS) < g.core.moves.length - 2 && g.core.moves.includes(PASS))).toBe(true);
    expect(new Set(games.map((g) => g.core.size))).toEqual(new Set([9, 13, 19]));
  });

  it.each(newer())('%s is kept as written, by its id and date, and not replayed', (_, record) => {
    expect(readFinished(record)).toEqual({ newer: record, id: record.id, endedAt: record.endedAt });
  });

  it('fields from a later app are read past and kept', () => {
    const [, record] = extended()[0];
    expect(game(record)).toEqual(record);
  });

  it.each(broken())('refuses a record with %s', (_, record) => {
    expect(readFinished(record)).toBeNull();
  });
});

describe('replaying', () => {
  const base = () => game(readable().find(([f]) => f.endsWith('bot-9-scored.json'))![1]);
  const problem = (f: FinishedGame) => {
    const r = replayFinished(f);
    return r.ok ? null : r.problem;
  };

  it('finds a record that does not replay to its result', () => {
    const f = base();
    expect(problem({ ...f, core: { ...f.core, result: { ...f.core.result, margin: 1.5 } } })).toMatch(/^replays as black by/);
    expect(problem({ ...f, core: { ...f.core, result: { ...f.core.result, winner: 'white' } } })).toMatch(/^replays as black/);
    expect(problem({ ...f, core: { ...f.core, moves: [p('E5'), p('E5')] } })).toBe('move 2 refused: occupied');
    expect(problem({ ...f, core: { ...f.core, moves: f.core.moves.slice(0, -1) } })).toBe('scored before two passes');
    expect(problem({ ...f, core: { ...f.core, dead: [p('J1')] } })).toBe('a dead stone on an empty point');
    expect(problem({ ...f, core: { ...f.core, rules: 99 } })).toBe('rules 99 unknown');
  });

  it('starts from the setup, not from the handicap the meta names', () => {
    const f = base();
    // A white stone on E5 before the first move makes Black's E5 illegal.
    expect(problem({ ...f, core: { ...f.core, setup: { black: [], white: [p('E5')] } } })).toMatch(/^move \d+ refused: occupied$/);
    expect(problem({ ...f, meta: { ...f.meta, handicap: 4 } })).toBeNull();
  });
});

describe('writing a record again', () => {
  it('keeps what a later app added and takes everything known from the new record', () => {
    const [, old] = extended()[0];
    const f = game(old);
    const recount: FinishedGame = {
      ...f,
      core: { ...f.core, result: { winner: 'white', reason: 'score', margin: 2.5 } },
      meta: { mode: 'bot', you: 'black', handicap: 0 },
    };
    const kept = JSON.parse(JSON.stringify(keepUnknown(f, recount)));
    expect(kept.device).toEqual({ model: 'Pixel 9' });
    expect(kept.core.clock).toEqual({ black: 312, white: 287 });
    expect(kept.core.setup).toEqual({ black: [], white: [], note: 'even' });
    expect(kept.core.result).toEqual({ winner: 'white', reason: 'score', margin: 2.5, points: { black: 46, white: 35 } });
    expect(kept.meta).toEqual({ mode: 'bot', you: 'black', handicap: 0, opening: 'tengen' });
  });
});
