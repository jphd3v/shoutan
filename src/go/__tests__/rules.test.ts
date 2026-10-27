import {
  acceptScore,
  BLACK,
  chainAt,
  EMPTY,
  legalPoints,
  maxHandicap,
  newGame,
  pass,
  play,
  pointFromName,
  pointName,
  resign,
  resumePlay,
  score,
  situationKey,
  setDead,
  toggleDead,
  WHITE,
} from '../rules';
import { at, playAll, position } from './helpers';
import type { GameState } from '../rules';

describe('setup and coordinates', () => {
  it('starts empty with Black to play', () => {
    const g = newGame(9);
    expect(g.board.every((s) => s === EMPTY)).toBe(true);
    expect(g.toPlay).toBe('black');
    expect(g.phase).toBe('playing');
    expect(g.komi).toBe(7.5);
  });

  it('places handicap stones on the star points, with White to play and komi of ½ plus a point per stone', () => {
    const names = (size: number, n: number) =>
      newGame(size, undefined, n)
        .board.flatMap((s, p) => (s === BLACK ? [pointName(size, p)] : []))
        .sort();
    expect(names(19, 2)).toEqual(['D4', 'Q16']);
    expect(names(19, 3)).toEqual(['D4', 'Q16', 'Q4']);
    expect(names(19, 4)).toEqual(['D16', 'D4', 'Q16', 'Q4']);
    expect(names(19, 5)).toEqual(['D16', 'D4', 'K10', 'Q16', 'Q4']);
    expect(names(19, 6)).toEqual(['D10', 'D16', 'D4', 'Q10', 'Q16', 'Q4']);
    expect(names(19, 7)).toEqual(['D10', 'D16', 'D4', 'K10', 'Q10', 'Q16', 'Q4']);
    expect(names(19, 8)).toEqual(['D10', 'D16', 'D4', 'K16', 'K4', 'Q10', 'Q16', 'Q4']);
    expect(names(19, 9)).toEqual(['D10', 'D16', 'D4', 'K10', 'K16', 'K4', 'Q10', 'Q16', 'Q4']);
    expect(names(13, 2)).toEqual(['D4', 'K10']);
    expect(names(13, 3)).toEqual(['D4', 'K10', 'K4']);
    expect(names(13, 4)).toEqual(['D10', 'D4', 'K10', 'K4']);
    expect(names(13, 5)).toEqual(['D10', 'D4', 'G7', 'K10', 'K4']);
    expect(names(13, 9)).toEqual(['D10', 'D4', 'D7', 'G10', 'G4', 'G7', 'K10', 'K4', 'K7']);
    expect(names(9, 2)).toEqual(['C3', 'G7']);
    expect(names(9, 3)).toEqual(['C3', 'G3', 'G7']);
    expect(names(9, 4)).toEqual(['C3', 'C7', 'G3', 'G7']);
    expect(names(9, 5)).toEqual(['C3', 'C7', 'E5', 'G3', 'G7']);
    for (const n of [2, 3, 5, 9]) {
      const g = newGame(19, undefined, n);
      expect(g.toPlay).toBe('white');
      expect(g.komi).toBe(n + 0.5);
    }
    const g = newGame(9, undefined, 3);
    expect(g.komi).toBe(3.5);
    expect(g.moves).toHaveLength(0);
    expect(g.seen.has(situationKey(g.board, 'white'))).toBe(true);
  });

  it('plays one stone as Black moving first on an empty board with ½ komi', () => {
    for (const size of [9, 13, 19]) {
      const g = newGame(size, undefined, 1);
      expect(g.board.every((s) => s === EMPTY)).toBe(true);
      expect(g.toPlay).toBe('black');
      expect(g.komi).toBe(0.5);
      expect(g.handicap).toBe(1);
    }
  });

  it('allows up to nine stones on 13×13 and 19×19, and five on 9×9 where the star points run out', () => {
    expect(maxHandicap(19)).toBe(9);
    expect(maxHandicap(13)).toBe(9);
    expect(maxHandicap(9)).toBe(5);
    expect(newGame(9, undefined, 0)).toEqual(newGame(9));
    expect(() => newGame(9, undefined, 6)).toThrow('Handicap');
    expect(() => newGame(19, undefined, 10)).toThrow('Handicap');
    expect(() => newGame(19, undefined, -1)).toThrow('Handicap');
  });

  it('rejects unsupported sizes and whole-number komi', () => {
    expect(() => newGame(1)).toThrow();
    expect(() => newGame(20)).toThrow();
    expect(() => newGame(9, 6)).toThrow('Komi');
  });

  it('names points with letters skipping I and rows from the bottom', () => {
    expect(pointName(9, 0)).toBe('A9');
    expect(pointName(9, 80)).toBe('J1');
    expect(pointName(19, pointFromName(19, 'T19'))).toBe('T19');
    expect(pointFromName(9, 'E5')).toBe(40);
    expect(() => pointFromName(9, 'K1')).toThrow();
  });
});

describe('playing stones', () => {
  it('places a stone and alternates turns', () => {
    const g = playAll(newGame(9), 'E5');
    expect(at(g, 'E5')).toBe(BLACK);
    expect(g.toPlay).toBe('white');
    expect(g.moves).toEqual([{ color: 'black', kind: 'play', point: 40, captured: 0 }]);
  });

  it('rejects occupied and out-of-bounds points without changing state', () => {
    const g = playAll(newGame(9), 'E5');
    expect(play(g, 40)).toEqual({ ok: false, reason: 'occupied' });
    expect(play(g, -1)).toEqual({ ok: false, reason: 'outOfBounds' });
    expect(play(g, 81)).toEqual({ ok: false, reason: 'outOfBounds' });
    expect(play(g, 2.5)).toEqual({ ok: false, reason: 'outOfBounds' });
  });

  it('does not mutate the previous state', () => {
    const g = newGame(9);
    play(g, 40);
    expect(g.board[40]).toBe(EMPTY);
    expect(g.moves).toEqual([]);
  });

  it('counts liberties of a chain', () => {
    const g = position(['.....', '.XX..', '.XO..', '.....', '.....']);
    const chain = chainAt(g.board, 5, pointFromName(5, 'B4'));
    expect(chain.stones).toHaveLength(3);
    expect(chain.liberties.size).toBe(6);
  });
});

describe('captures', () => {
  it('captures a single stone and counts the prisoner', () => {
    const g = position(['.X...', 'XO...', '.X...', '.....', '.....']);
    const r = play(g, pointFromName(5, 'C4'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.captured).toEqual([pointFromName(5, 'B4')]);
    expect(at(r.state, 'B4')).toBe(EMPTY);
    expect(r.state.captures.black).toBe(1);
  });

  it('captures a whole chain in the corner', () => {
    const g2 = position(['OO...', 'XX...', '.....', '.....', '.....']);
    const r = play(g2, pointFromName(5, 'C5'));
    expect(r.ok && r.captured.length).toBe(2);
    expect(r.ok && r.state.captures.black).toBe(2);
  });

  it('captures two separate chains with one move', () => {
    const g = position(['XO.OX', '.X.X.', '.....', '.....', '.....']);
    const r = play(g, pointFromName(5, 'C5'));
    expect(r.ok && r.captured.sort()).toEqual([1, 3]);
  });

  it('forbids suicide', () => {
    const g = position(['.X...', 'X....', '.....', '.....', '.....'], 'white');
    expect(play(g, 0)).toEqual({ ok: false, reason: 'suicide' });
  });

  it('forbids multi-stone suicide', () => {
    const g = position(['O.X..', 'XX...', '.....', '.....', '.....'], 'white');
    expect(play(g, 1)).toEqual({ ok: false, reason: 'suicide' });
  });

  it('allows a move with no liberties when it captures', () => {
    const g = position(['.XO..', 'XO...', 'O....', '.....', '.....'], 'white');
    const r = play(g, 0);
    expect(r.ok).toBe(true);
    expect(r.ok && r.captured).toHaveLength(2);
  });
});

describe('ko', () => {
  const ko = () => position(['.....', '.XO..', 'X.XO.', '.XO..', '.....'], 'white');

  it('forbids immediately retaking a ko', () => {
    const afterTake = playAll(ko(), 'B3'); // White captures C3
    expect(at(afterTake, 'C3')).toBe(EMPTY);
    expect(play(afterTake, pointFromName(5, 'C3'))).toEqual({ ok: false, reason: 'ko' });
  });

  it('allows retaking after a move elsewhere', () => {
    const g = playAll(ko(), 'B3', 'E1', 'E5');
    const r = play(g, pointFromName(5, 'C3'));
    expect(r.ok).toBe(true);
    expect(r.ok && r.captured).toEqual([pointFromName(5, 'B3')]);
  });

  it('forbids a triple ko from cycling back to an earlier position', () => {
    // Three kos: Black captures first in the upper left (C8) and lower left (C4), White in the upper right (H8).
    const triple = position([
      '.XO...OX.',
      'XO.O.OX.X',
      '.XO...OX.',
      '.........',
      '.XO......',
      'XO.O.....',
      '.XO......',
      '.........',
      '.........',
    ]);
    // Each capture retakes a ko the opponent took two moves before, so simple ko never forbids it.
    const fifth = playAll(triple, 'C8', 'H8', 'C4', 'B8', 'G8');
    expect(play(fifth, pointFromName(9, 'B4'))).toEqual({ ok: false, reason: 'ko' });
    // The same move from the same board with no history is legal: only the repetition forbids it.
    const fresh = position(
      Array.from({ length: 9 }, (_, y) =>
        fifth.board
          .slice(y * 9, y * 9 + 9)
          .map((v) => '.XO'[v])
          .join(''),
      ),
      'white',
    );
    expect(play(fresh, pointFromName(9, 'B4')).ok).toBe(true);
  });

  it('a pass followed by a move elsewhere lifts the ko ban', () => {
    const g = pass(playAll(ko(), 'B3'));
    expect(g.toPlay).toBe('white');
    const g2 = playAll(g, 'E1');
    expect(play(g2, pointFromName(5, 'C3')).ok).toBe(true);
  });
});

describe('passing, resigning and scoring', () => {
  it('two consecutive passes end play and start scoring', () => {
    const g1 = pass(newGame(9));
    expect(g1.phase).toBe('playing');
    expect(g1.toPlay).toBe('white');
    const g2 = pass(g1);
    expect(g2.phase).toBe('scoring');
    expect(play(g2, 0)).toEqual({ ok: false, reason: 'notPlaying' });
  });

  it('a move between passes resets the count', () => {
    const g = pass(playAll(pass(newGame(9)), 'E5'));
    expect(g.phase).toBe('playing');
    expect(g.consecutivePasses).toBe(1);
  });

  it('an empty board gives White the game by komi', () => {
    const g = acceptScore(pass(pass(newGame(9))));
    expect(g.phase).toBe('over');
    expect(g.result).toEqual({ winner: 'white', reason: 'score', margin: 7.5, black: 0, white: 7.5 });
  });

  it('scores area: stones plus surrounded empty points', () => {
    const g = position(['..XO.', '..XO.', '..XO.', '..XO.', '..XO.']);
    const s = score(g);
    expect(s.black).toBe(5 + 10);
    expect(s.white).toBe(5 + 5 + 7.5);
  });

  it('splits dame half each', () => {
    const g = position(['XXX', 'X.O', 'OOO'], 'black', 0.5);
    const s = score(g);
    expect(s.owner[4]).toBe(EMPTY);
    expect(s.shared).toBe(1);
    expect(s.black).toBe(4.5);
    expect(s.white).toBe(5);
  });

  it('dead stones count for the opponent', () => {
    const g = pass(pass(position(['X...', '....', '..O.', '....'], 'black', 0.5)));
    const withDead = toggleDead(g, pointFromName(4, 'C2'));
    expect(withDead.dead.has(pointFromName(4, 'C2'))).toBe(true);
    expect(score(withDead).black).toBe(16);
    expect(acceptScore(withDead).result).toMatchObject({ winner: 'black', margin: 15.5 });
  });

  it('toggles whole chains and ignores empty points', () => {
    const g = pass(pass(position(['XX..', '....', '....', '...O'])));
    const marked = toggleDead(g, 0);
    expect([...marked.dead].sort()).toEqual([0, 1]);
    expect(toggleDead(marked, 1).dead.size).toBe(0);
    expect(toggleDead(g, 5)).toBe(g);
  });

  it('a guessed mark stays a guess until a player taps its group', () => {
    const g = setDead(pass(pass(position(['XX..', '....', '....', '..OO']))), [0, 1], [0, 1, 14, 15]);
    expect([...g.unsure!].sort()).toEqual([0, 1, 14, 15]);
    const tapped = toggleDead(g, 14);
    expect([...tapped.dead].sort()).toEqual([0, 1, 14, 15]);
    expect([...tapped.unsure!].sort()).toEqual([0, 1]);
    expect(setDead(g, [0, 1]).unsure).toBeUndefined();
    expect(resumePlay(g).unsure).toBeUndefined();
  });

  it('resume returns to play and clears dead marks', () => {
    const g = toggleDead(pass(pass(position(['X...', '....', '....', '...O']))), 0);
    const r = resumePlay(g);
    expect(r.phase).toBe('playing');
    expect(r.dead.size).toBe(0);
    expect(r.consecutivePasses).toBe(0);
  });

  it('resignation ends the game for the other colour', () => {
    const g = resign(newGame(9), 'black');
    expect(g.phase).toBe('over');
    expect(g.result).toEqual({ winner: 'white', reason: 'resignation' });
    expect(play(g, 0)).toEqual({ ok: false, reason: 'notPlaying' });
    expect(pass(g)).toBe(g);
    expect(resign(g, 'white')).toBe(g);
  });

  it('lists legal points, excluding suicide and ko', () => {
    const g = position(['.X.', 'X..', '...'], 'white', 0.5);
    expect(legalPoints(g)).not.toContain(0);
    expect(legalPoints(g)).toHaveLength(6);
  });
});

it('the same moves always give the same state', () => {
  const moves = ['E5', 'D4', 'C3', 'F6', 'D5'];
  const a = playAll(newGame(9), ...moves);
  const b = playAll(newGame(9), ...moves);
  expect(a.board).toEqual(b.board);
  expect(at(a, 'D4')).toBe(WHITE);
});

/**
 * The Chinese rules, Chinese Weiqi Association, 2002 edition (中国围棋竞赛规则), quoted from the
 * association's text at https://cwqa.qilue.com/rules/.
 */
describe('the Chinese rules (2002)', () => {
  it('art. 5: a stone left without liberties that captures nothing may not be played', () => {
    // 棋盘上的任何一点，如某方下子后，该子立即呈无气状态，同时又不能提取对方的棋子，这个点叫做"禁着点"。
    const g = position(['.X.', 'X..', '...'], 'white');
    expect(play(g, pointFromName(3, 'A3'))).toEqual({ ok: false, reason: 'suicide' });
  });

  describe('art. 6: a move may not make the opponent face a position that has occurred before', () => {
    // 着子后不得使对方重复面临曾出现过的局面。
    const ko = () => position(['.....', '.XO..', 'X.XO.', '.XO..', '.....'], 'white');
    const taken = () => playAll(ko(), 'B3').board;

    it('forbids recreating a board with the same player to move', () => {
      const g = { ...ko(), seen: new Set([...ko().seen, situationKey(taken(), 'black')]) };
      expect(play(g, pointFromName(5, 'B3'))).toEqual({ ok: false, reason: 'ko' });
    });

    it('allows the same board with the other player to move', () => {
      const g = { ...ko(), seen: new Set([...ko().seen, situationKey(taken(), 'white')]) };
      expect(play(g, pointFromName(5, 'B3')).ok).toBe(true);
    });

    it('never refuses a pass, and a pass records the position it hands over', () => {
      const g = pass(playAll(ko(), 'B3'));
      expect(g.seen.has(situationKey(g.board, 'white'))).toBe(true);
      expect(pass(g).phase).toBe('scoring');
    });
  });

  it('arts. 2.5 and 7.3: passing costs nothing, and two passes in a row end play', () => {
    // 允许任何一方放弃下子权而使用虚着。双方连续使用虚着，为终局。
    const g = position(['XX.OO', 'XX.OO', 'XX.OO', 'XX.OO', 'XX.OO']);
    const passed = pass(pass(g));
    expect(passed.phase).toBe('scoring');
    expect(passed.captures).toEqual(g.captures);
    expect(score(passed)).toEqual(score(g));
  });

  describe('art. 9: each side counts its living stones and the points they surround, and shares the points between', () => {
    // 将双方死子清理出盘外后，对任意一方的活棋和活棋围住的点以子为单位进行计数。双方活棋之间的空点各得一半。

    it('dead stones are taken off first, and the area they leave counts for the side around them', () => {
      const g = pass(pass(position(['XXXXX', 'X.O.X', 'XXXXX', '.....', 'OOOOO'], 'black', 0.5)));
      const counted = score(toggleDead(g, pointFromName(5, 'C4')));
      // Black: 12 stones and the 3 points inside, with the dead stone's point; the empty row is shared.
      expect(counted.black).toBe(12 + 3 + 2.5);
      expect(counted.white).toBe(5 + 2.5 + 0.5);
    });

    it('points touching both colours, as a seki’s shared liberties do, go half to each; an eye counts for its owner', () => {
      // B4, D5 and C1 touch both colours; A5 and A3 are enclosed by Black alone.
      const seki = position(['.XO.X', 'X.OXX', '.XOX.', 'XOOXX', 'OO.XX'], 'black', 0.5);
      const s = score(seki);
      expect(s.owner[pointFromName(5, 'A5')]).toBe(BLACK);
      expect(s.shared).toBe(3);
    });

    it('filling shared points one each keeps the margin; an extra one gains a point', () => {
      const open = position(['XXXX.', 'XXXX.', '.....', '.OOOO', '.OOOO'], 'black', 0.5);
      const margin = (g: GameState) => score(g).black - score(g).white;
      const both = playAll(open, 'A3', 'E3');
      expect(margin(both)).toBe(margin(open));
      expect(margin(playAll(both, 'B3'))).toBe(margin(both) + 1);
    });
  });

  describe('arts. 9 and 11: Black gives back 3¾ stones and needs more than 180½ of 361', () => {
    // 黑棋贴还3又3/4子。例如黑方总共得185子则黑胜3/4子，得184子则黑负1/4子，得184.5子则为黑胜1/4子。
    /** A full 19×19 board: `black` stones, then `shared` empty points, then White. */
    const board = (black: number, shared: number) => {
      const rows = Array.from({ length: 361 }, (_, p) => (p < black ? 'X' : p < black + shared ? '.' : 'O')).join('');
      return position(Array.from({ length: 19 }, (_, r) => rows.slice(r * 19, r * 19 + 19)));
    };
    /** The result in stones (子), as the rules state it: half the point margin. */
    const inStones = (g: GameState) => {
      const s = score(g);
      return (s.black - s.white) / 2;
    };

    it('185 stones win by ¾, 184½ by ¼, and 184 lose by ¼', () => {
      expect(score(board(185, 0)).black).toBe(185);
      expect(inStones(board(185, 0))).toBe(0.75);
      expect(score(board(184, 1)).black).toBe(184.5);
      expect(inStones(board(184, 1))).toBe(0.25);
      expect(inStones(board(184, 0))).toBe(-0.25);
    });

    it('no game is drawn', () => {
      for (const [b, d] of [
        [180, 1],
        [181, 0],
        [184, 1],
        [176, 9],
      ])
        expect(inStones(board(b, d))).not.toBe(0);
      expect(acceptScore(pass(pass(board(184, 1)))).result).toMatchObject({ winner: 'black', margin: 0.5 });
    });
  });
});
