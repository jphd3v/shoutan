import { allLiberties, connections, libertiesOf, momentsAfter, passIsEarly, suggestionsFor } from '../guide';
import { newGame, pass, pointFromName } from '../rules';
import { playAll, position } from './helpers';

const pts = (size: number, ...names: string[]) => names.map((n) => pointFromName(size, n)).sort((a, b) => a - b);
const kinds = (list: { kind: string }[]) => list.map((m) => m.kind);

describe('libertiesOf', () => {
  it('lists the liberties of the whole group', () => {
    const g = position(['.....', '.XX..', '.....', '.....', '.....']);
    expect(libertiesOf(g, pointFromName(5, 'B4')).sort((a, b) => a - b)).toEqual(pts(5, 'B5', 'C5', 'A4', 'D4', 'B3', 'C3'));
  });

  it('is empty on an empty point', () => {
    expect(libertiesOf(position(['...', '...', '...']), 0)).toEqual([]);
  });
});

describe('allLiberties', () => {
  it('marks every liberty of every group, and the last liberty of a group in atari', () => {
    const g = position(['XO...', '.X...', '.....', '.....', '.....']);
    const dots = new Map(allLiberties(g).map((d) => [d.point, d.last]));
    // White B5 has one liberty, C5; black A5 has one, A4; black B4 has A4, C4 and B3.
    expect([...dots.keys()].sort((a, b) => a - b)).toEqual(pts(5, 'C5', 'A4', 'C4', 'B3'));
    expect(dots.get(pointFromName(5, 'C5'))).toEqual({ black: false, white: true });
    // A point that is one group's last liberty stays marked as last even when another group shares it.
    expect(dots.get(pointFromName(5, 'A4'))).toEqual({ black: true, white: false });
    expect(dots.get(pointFromName(5, 'C4'))).toEqual({ black: false, white: false });
  });

  it('a last liberty is marked for the colour in atari only, so a point both colours share shows both', () => {
    // White A5's only liberty is A4, which is also one of black A3's three.
    const g = position(['OX...', '.....', 'X....', '.....', '.....']);
    expect(allLiberties(g).find((l) => l.point === pointFromName(5, 'A4'))).toEqual({
      point: pointFromName(5, 'A4'),
      black: true,
      white: true,
      last: { black: false, white: true },
    });
  });

  it('leaves out liberties inside territory one colour already holds', () => {
    // B4 is enclosed by black alone: a point Black holds, not a liberty to watch.
    const g = position(['.X...', 'X.X..', '.X...', '.....', '.....']);
    const points = allLiberties(g).map((l) => l.point);
    expect(points).not.toContain(pointFromName(5, 'B4'));
    expect(points).toContain(pointFromName(5, 'C5'));
  });

  it('a connected group lists each liberty once, however many of its stones touch it', () => {
    // B4 touches both B5 and A4.
    const g = position(['XX...', 'X....', '.....', '.....', '.....']);
    expect(libertiesOf(g, pointFromName(5, 'A5')).sort((a, b) => a - b)).toEqual(pts(5, 'C5', 'B4', 'A3'));
    expect(
      allLiberties(g)
        .map((l) => l.point)
        .sort((a, b) => a - b),
    ).toEqual(pts(5, 'C5', 'B4', 'A3'));
  });

  it("says whose liberty each point is, so the dots can take the stones' colours", () => {
    const g = position(['XO...', '.X...', '.....', '.....', '.....']);
    const at = (name: string) => allLiberties(g).find((d) => d.point === pointFromName(5, name));
    expect(at('C5')).toMatchObject({ black: false, white: true });
    expect(at('B3')).toMatchObject({ black: true, white: false });
    // C5 touches white B5 only; C4 touches black B4 only; none touches both here.
    const shared = position(['.....', '.X.O.', '.....', '.....', '.....']);
    expect(allLiberties(shared).find((d) => d.point === pointFromName(5, 'C4'))).toMatchObject({ black: true, white: true });
  });

  it('is empty on an empty board', () => {
    expect(allLiberties(position(['...', '...', '...']))).toEqual([]);
  });
});

describe('connections', () => {
  it('links each stone to its same-coloured neighbours to the right and below, once per pair', () => {
    const g = position(['XX.O.', 'X..O.', '.XO..', '.....', '.....']);
    const at = (name: string) => pointFromName(5, name);
    expect(connections(g.board, 5)).toEqual([
      { from: at('A5'), to: at('B5'), color: 'black' },
      { from: at('A5'), to: at('A4'), color: 'black' },
      { from: at('D5'), to: at('D4'), color: 'white' },
    ]);
  });
});

describe('momentsAfter', () => {
  it('a plain capture is not announced: the stones leaving the board show it', () => {
    const before = position(['.X...', 'XOX..', '.....', '.....', '.....']);
    expect(momentsAfter(before, playAll(before, 'B3'))).toEqual([]);
  });

  it('says nothing when the second game does not continue the first', () => {
    const before = position(['.X...', 'XOX..', '.....', '.....', '.....']);
    // Another game one move longer, where B4 is empty: not a capture, just a different board.
    const other = playAll(newGame(5), 'B3');
    expect(momentsAfter(before, other)).toEqual([]);
    expect(momentsAfter(playAll(newGame(9), 'E5'), playAll(newGame(9), 'D4', 'E5'))).toEqual([]);
    expect(momentsAfter(newGame(9), playAll(newGame(13), 'D4'))).toEqual([]);
  });

  it('putting the other player’s group in atari is not announced', () => {
    const before = position(['.....', '.XO..', '..X..', '.....', '.....']);
    expect(momentsAfter(before, playAll(before, 'C5'))).toEqual([]);
  });

  it('playing into atari is not announced: the board shows it', () => {
    const before = position(['.....', '.....', '.....', 'O....', '.....'], 'black');
    expect(momentsAfter(before, playAll(before, 'A1'))).toEqual([]);
  });

  it('taking a ko is announced as ko, not as playing into atari', () => {
    const before = position(['.....', '.XO..', 'X.XO.', '.XO..', '.....'], 'white');
    const after = playAll(before, 'B3');
    expect(momentsAfter(before, after)).toEqual([{ kind: 'ko', color: 'black', points: pts(5, 'C3'), count: 1 }]);
  });

  it('capturing one stone is not ko when the capturing stone keeps more liberties', () => {
    const before = position(['.X...', 'XOX..', '.....', '.....', '.....']);
    expect(kinds(momentsAfter(before, playAll(before, 'B3')))).not.toContain('ko');
  });

  it('a pass has no moments', () => {
    const g = position(['...', '...', '...']);
    expect(momentsAfter(g, { ...g, moves: [{ color: 'black', kind: 'pass' }] })).toEqual([]);
  });
});

describe('suggestionsFor', () => {
  it('suggests capturing a group in atari, biggest first', () => {
    const g = position(['OX...', '.....', 'XX...', 'XOX..', 'OO...'], 'black');
    const s = suggestionsFor(g);
    expect(s[0]).toEqual({ kind: 'capture', point: pointFromName(5, 'C1'), count: 3 });
    expect(s[1]).toEqual({ kind: 'capture', point: pointFromName(5, 'A4'), count: 1 });
  });

  it('puts saving your own stones before capturing', () => {
    // Black A5 is in atari (only A4 left); White B5 is in atari too (only C5 left).
    const g = position(['XO...', '.X...', '.....', '.....', '.....'], 'black');
    expect(suggestionsFor(g).map((s) => s.kind)).toEqual(['escape', 'capture']);
  });

  it('suggests escaping when your group is in atari', () => {
    const g = position(['.....', '.....', '..O..', '.OXO.', '.....'], 'black');
    expect(suggestionsFor(g)).toEqual([{ kind: 'escape', point: pointFromName(5, 'C1'), count: 1 }]);
  });

  it('does not suggest an escape that leaves the group in atari', () => {
    const g = position(['.....', '.....', '..O..', '.OXO.', '.O.O.'], 'black');
    expect(kinds(suggestionsFor(g))).not.toContain('escape');
  });

  it('suggests atari on a group with two liberties, but not by self-atari', () => {
    const g = position(['.....', '.....', '..X..', '.XO..', '.O...'], 'black');
    expect(suggestionsFor(g)).toEqual([{ kind: 'atari', point: pointFromName(5, 'D2'), count: 1 }]);
  });

  it('shows at most two suggestions', () => {
    const g = position(['O.O.O', 'X.X.X', '.....', '.....', '.....'], 'black');
    expect(suggestionsFor(g)).toHaveLength(2);
  });

  it('suggests nothing outside play', () => {
    const g = position(['XO...', '.X...', '.....', '.....', '.....'], 'black');
    expect(suggestionsFor({ ...g, phase: 'scoring' })).toEqual([]);
  });
});

describe('passIsEarly', () => {
  it('is early while much of the board is open, and not once it is divided', () => {
    expect(passIsEarly(playAll(newGame(9), 'E5', 'C3'))).toBe(true);
    // Black's wall on the D line and White's on the E line divide the whole board.
    const divided = position(Array(9).fill('...XO....'));
    expect(passIsEarly(divided)).toBe(false);
    expect(passIsEarly(pass(pass(divided)))).toBe(false);
  });
});
