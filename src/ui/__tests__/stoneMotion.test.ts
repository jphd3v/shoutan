import { playAll, position } from '../../go/__tests__/helpers';
import { BLACK, newGame, pass, pointFromName, WHITE } from '../../go/rules';
import { MOVE_GAP_MS, SLIDE_MS, STAGGER_MS, stoneMotion } from '../stoneMotion';

describe('stoneMotion', () => {
  const ko = position(['.X.', 'XO.', '.X.'], 'black');
  const B2 = pointFromName(3, 'B2');
  const C2 = pointFromName(3, 'C2');

  it('a move sets its stone down', () => {
    const before = newGame(9);
    const after = playAll(before, 'E5');
    expect(stoneMotion(before, after)).toMatchObject({ placed: [{ p: pointFromName(9, 'E5'), delay: 0 }], captured: [], lifted: [] });
  });

  it('a capture flies the taken stones away as the stone lands', () => {
    const after = playAll(ko, 'C2');
    expect(stoneMotion(ko, after)).toMatchObject({ placed: [{ p: C2, delay: 0 }], captured: [{ p: B2, s: WHITE, delay: 0 }] });
  });

  it('dead stones taken off at the count fly to their captor as captures do', () => {
    const off = { ...ko, board: ko.board.map((v, p) => (p === B2 ? 0 : v)) as typeof ko.board };
    expect(stoneMotion(ko, off)).toMatchObject({ captured: [{ p: B2, s: WHITE, delay: 0 }], vanished: [] });
    // Put back when the count steps back, they simply reappear.
    expect(stoneMotion(off, ko)).toMatchObject({ captured: [], returned: [], vanished: [] });
  });

  it('undo is the reverse: the stone lifts off, then the captured stones fly back', () => {
    const after = playAll(ko, 'C2');
    expect(stoneMotion(after, ko)).toEqual({
      placed: [],
      lifted: [{ p: C2, s: BLACK, delay: 0 }],
      captured: [],
      returned: [{ p: B2, s: WHITE, delay: SLIDE_MS / 2 }],
      vanished: [],
    });
  });

  it('undoing two moves lifts the newest first; redoing them sets them down in order', () => {
    const start = newGame(9);
    const two = playAll(start, 'E5', 'C3');
    const [E5, C3] = [pointFromName(9, 'E5'), pointFromName(9, 'C3')];
    expect(stoneMotion(two, start).lifted).toEqual([
      { p: C3, s: WHITE, delay: 0 },
      { p: E5, s: BLACK, delay: MOVE_GAP_MS },
    ]);
    expect(stoneMotion(start, two).placed).toEqual([
      { p: E5, delay: 0 },
      { p: C3, delay: MOVE_GAP_MS },
    ]);
  });

  it('several captured stones leave one after another, timed with the move that took them', () => {
    const before = position(['XXXXX', 'OOOOX', 'XX.XX', '.....', '.....'], 'white');
    const after = playAll(pass(before), 'C3');
    const captured = stoneMotion(before, after).captured;
    expect(captured).toHaveLength(4);
    expect(captured.map((c) => c.delay)).toEqual([0, 1, 2, 3].map((k) => MOVE_GAP_MS + STAGGER_MS * k));
  });

  it('a new game clears the stones in place instead of undoing them one by one', () => {
    const before = playAll(newGame(9), 'E5', 'C3', 'G5', 'G3', 'C7');
    const m = stoneMotion(before, newGame(9));
    expect(m.vanished).toHaveLength(5);
    expect(m.lifted).toEqual([]);
    expect(stoneMotion(newGame(9), before).placed).toEqual([]);
  });

  it('a pass moves no stones', () => {
    const before = playAll(newGame(9), 'E5');
    expect(stoneMotion(before, pass(before))).toEqual({ placed: [], lifted: [], captured: [], returned: [], vanished: [] });
  });
});
