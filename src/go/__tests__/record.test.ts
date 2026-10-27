import { gameRecord } from '../record';
import { newGame, pass, resign } from '../rules';
import { playAll, position } from './helpers';

describe('gameRecord', () => {
  it('lists the moves in order with coordinates', () => {
    const g = pass(playAll(newGame(9), 'E5', 'C3'));
    expect(gameRecord(g)).toBe('9x9 komi 7.5, playing: B E5, W C3, B pass');
  });

  it('notes the handicap when a game has one', () => {
    expect(gameRecord(newGame(13, undefined, 2))).toBe('13x13 handicap 2 komi 2.5, playing: no moves');
  });

  it('notes captures, the phase and resignation', () => {
    const start = position(['.X.', 'XO.', '.X.'], 'black');
    const g = resign(playAll(start, 'C2'), 'white');
    expect(gameRecord(g)).toBe('3x3 komi 7.5, over: B C2 x1, W resigns');
  });
});
