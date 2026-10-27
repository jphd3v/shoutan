import { playAll, position } from '../../go/__tests__/helpers';
import { acceptScore, newGame, pass, pointFromName, resign, resumePlay, setDead, toggleDead } from '../../go/rules';
import { cueFor, resultCue } from '../cues';

const names = (cue: ReturnType<typeof cueFor>) => cue?.sounds.map((s) => s.name) ?? [];

describe('cueFor', () => {
  it('a placed stone clicks with a light tap', () => {
    const before = newGame(9);
    const after = playAll(before, 'E5');
    const cue = cueFor(before, after, { viewer: null });
    expect(names(cue)).toEqual(['stone']);
    expect(cue).toMatchObject({ haptic: 'light', captured: [], shake: false, passed: null });
  });

  it('a capture adds the capture sound after the click and lists the captured stones', () => {
    const before = position(['.X.', 'XO.', '.X.'], 'black');
    const after = playAll(before, 'C2');
    const cue = cueFor(before, after, { viewer: null })!;
    expect(cue.sounds).toEqual([
      { name: 'stone', delay: 0 },
      { name: 'capture', delay: 90 },
    ]);
    expect(cue.captured).toEqual([pointFromName(3, 'B2')]);
    expect(cue.haptic).toBe('medium');
  });

  it('a big capture rattles', () => {
    const before = position(['XXXXX', 'OOOOX', 'XX.XX', '.....', '.....'], 'black');
    const after = playAll(before, 'C3');
    const cue = cueFor(before, after, { viewer: null })!;
    expect(cue.captured).toHaveLength(4);
    expect(names(cue)).toEqual(['stone', 'captureMany']);
  });

  it('a refused move shakes and warns, even when the game did not change', () => {
    const g = newGame(9);
    const cue = cueFor(g, g, { viewer: null, refused: true });
    expect(cue).toMatchObject({ shake: true, haptic: 'warning' });
    expect(names(cue)).toEqual(['illegal']);
    expect(cueFor(g, g, { viewer: null, refused: false })).toBeNull();
  });

  it('a pass says who passed', () => {
    const before = newGame(9);
    const cue = cueFor(before, pass(before), { viewer: null });
    expect(cue).toMatchObject({ passed: 'black', ended: false });
    expect(names(cue)).toEqual(['pass']);
  });

  it('the second pass ends the game: the board says so before the stones are marked', () => {
    const one = pass(newGame(9));
    const cue = cueFor(one, pass(one), { viewer: null });
    expect(cue).toMatchObject({ passed: 'white', ended: true });
    expect(names(cue)).toEqual(['pass']);
  });

  it('online, the opponent moving chimes; your own move does not', () => {
    const before = newGame(9);
    const after = playAll(before, 'E5');
    expect(names(cueFor(before, after, { viewer: 'white', chimeForOpponent: true }))).toEqual(['stone', 'turn']);
    expect(names(cueFor(before, after, { viewer: 'black', chimeForOpponent: true }))).toEqual(['stone']);
  });

  it('marking stones while counting ticks', () => {
    const scoring = setDead(pass(pass(playAll(newGame(9), 'E5'))), []);
    expect(names(cueFor(scoring, toggleDead(scoring, pointFromName(9, 'E5')), { viewer: null }))).toEqual(['tick']);
  });

  it('the result celebrates the winner and is calm for the loser', () => {
    const scoring = pass(pass(playAll(newGame(9), 'E5')));
    const over = acceptScore(scoring);
    expect(over.result?.winner).toBe('black');
    expect(names(cueFor(scoring, over, { viewer: null }))).toEqual(['win']);
    expect(names(cueFor(scoring, over, { viewer: 'black' }))).toEqual(['win']);
    expect(names(cueFor(scoring, over, { viewer: 'white' }))).toEqual(['end']);
    expect(cueFor(scoring, over, { viewer: 'white' })?.haptic).toBe('success');
  });

  it('when the board counts the score first, the result waits for the count to end', () => {
    const scoring = pass(pass(playAll(newGame(9), 'E5')));
    const over = acceptScore(scoring);
    expect(cueFor(scoring, over, { viewer: null, deferResult: true })).toBeNull();
    expect(resultCue(over, 'black')).toMatchObject({ sounds: [{ name: 'win', delay: 0 }], haptic: 'success' });
    expect(resultCue(over, 'white').sounds).toEqual([{ name: 'end', delay: 0 }]);
  });

  it('a resignation is never deferred', () => {
    const before = playAll(newGame(9), 'E5');
    expect(names(cueFor(before, resign(before, 'white'), { viewer: 'white', deferResult: true }))).toEqual(['end']);
  });

  it('resigning ends without a click', () => {
    const before = playAll(newGame(9), 'E5');
    const after = resign(before, 'white');
    expect(names(cueFor(before, after, { viewer: 'white' }))).toEqual(['end']);
  });

  it('a move taken back makes a soft tap and nothing else', () => {
    const one = playAll(newGame(9), 'E5');
    expect(cueFor(one, newGame(9), { viewer: null, undone: true })).toEqual({
      sounds: [{ name: 'undo', delay: 0 }],
      haptic: null,
      shake: false,
      passed: null,
      ended: false,
      captured: [],
    });
  });

  it('a new game, resuming and unchanged states make no noise', () => {
    const one = playAll(newGame(9), 'E5');
    expect(cueFor(one, newGame(9), { viewer: null })).toBeNull();
    const scoring = pass(pass(one));
    expect(cueFor(scoring, resumePlay(scoring), { viewer: null })).toBeNull();
    expect(cueFor(one, one, { viewer: null })).toBeNull();
  });
});
