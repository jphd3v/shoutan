import { BLACK, EMPTY, pointFromName, WHITE } from '../rules';
import { parseSgf, replaySgf } from '../sgf';

describe('parseSgf', () => {
  it('reads size, komi, result and the main line, with passes', () => {
    const g = parseSgf('(;GM[1]FF[4]SZ[9]KM[7.5]RE[W+3.5];B[ee];W[cc](;B[];W[tt])(;B[aa]))');
    expect(g).toMatchObject({ size: 9, komi: 7.5, result: { winner: 'white', margin: 3.5 } });
    expect(g.moves).toEqual([
      { color: 'black', point: pointFromName(9, 'E5') },
      { color: 'white', point: pointFromName(9, 'C7') },
      { color: 'black', point: null },
      { color: 'white', point: null },
    ]);
  });

  it('reads setup stones, compressed point lists, escapes and other results', () => {
    const g = parseSgf('(;SZ[5]C[a \\] bracket]AB[aa:bb][ee]AW[ca]RE[B+R])');
    expect(g.setup.black).toEqual([0, 1, 5, 6, 24]);
    expect(g.setup.white).toEqual([2]);
    expect(g.setup.empty).toEqual([]);
    expect(g.result).toEqual({ winner: 'black', margin: null });
    expect(parseSgf('(;SZ[9]RE[0])').result).toEqual({ winner: null, margin: 0 });
    expect(parseSgf('(;SZ[9])')).toMatchObject({ size: 9, komi: 0, result: null });
  });

  it('defaults to 19×19 and rejects what it cannot read', () => {
    expect(parseSgf('(;B[pd])').size).toBe(19);
    expect(() => parseSgf('no game here')).toThrow();
    expect(() => parseSgf('(;SZ[9];B[zz])')).toThrow(/zz/);
  });
});

describe('replaySgf', () => {
  it('plays setup stones and moves through the rules, capturing as it goes', () => {
    const g = replaySgf(parseSgf('(;SZ[5]AB[ba]AW[aa];B[ab];W[cc];B[dd])'));
    expect(g.board[0]).toBe(EMPTY);
    expect(g.board[pointFromName(5, 'C3')]).toBe(WHITE);
    expect(g.board[pointFromName(5, 'D2')]).toBe(BLACK);
    expect(g.phase).toBe('playing');
  });

  it('places setup stones from later nodes before the next move', () => {
    const g = parseSgf('(;SZ[5];AB[aa]AE[cc];AW[bb];W[cc];B[dd])');
    expect(g.moves[0].setup).toEqual({ black: [0], white: [6], empty: [12] });
    expect(g.moves[1].setup).toBeUndefined();
    const s = replaySgf(g);
    expect([s.board[0], s.board[6], s.board[12]]).toEqual([BLACK, WHITE, WHITE]);
  });

  it('ends play after two passes and says which move was illegal', () => {
    expect(replaySgf(parseSgf('(;SZ[9];B[ee];W[];B[])')).phase).toBe('scoring');
    // What a record shows after two passes is cleanup, not play: the recorded result is scored before it.
    const ended = replaySgf(parseSgf('(;SZ[9];B[ee];W[];B[];W[cc];B[dd])'));
    expect(ended.moves).toHaveLength(3);
    expect(ended.phase).toBe('scoring');
    // The moves after it are still checked against the rules, not dropped unread.
    expect(() => replaySgf(parseSgf('(;SZ[9];B[ee];W[];B[];W[cc];B[cc])'))).toThrow('move 5 (B C7): occupied');
    expect(() => replaySgf(parseSgf('(;SZ[9];B[ee];W[ee])'))).toThrow('move 2 (W E5): occupied');
  });
});
