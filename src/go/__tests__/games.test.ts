/**
 * Real games, replayed through the rules and scored. Where each record comes from and its licence
 * is in games/README.md.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { estimateDead, guessDead } from '../ai';
import { chainAt, EMPTY, pass, play, pointFromName, score, setDead } from '../rules';
import { deadEstimatePlayouts } from '../session';
import { parseSgf, replaySgf, SgfGame } from '../sgf';

const dir = join(__dirname, 'games');
const read = (file: string): SgfGame => parseSgf(readFileSync(join(dir, file), 'latin1'));
const files = (sub: string) => readdirSync(join(dir, sub)).filter((f) => f.endsWith('.sgf'));
/** The recorded margin from Black's side, e.g. W+12.5 is -12.5. */
const recorded = (g: SgfGame) => (g.result!.winner === 'black' ? 1 : -1) * g.result!.margin!;

describe('famous games', () => {
  it.each(files('classics'))('%s replays move by move without an illegal move', (file) => {
    const g = read(join('classics', file));
    const end = replaySgf(g);
    expect(end.moves).toHaveLength(g.moves.length);
    // Every chain left on the board still has a liberty, so every capture was taken off.
    end.board.forEach((s, p) => {
      if (s !== EMPTY) expect(chainAt(end.board, end.size, p).liberties.size).toBeGreaterThan(0);
    });
  });
});

describe('computer games played out under Tromp-Taylor rules (CGOS)', () => {
  // These were played until every dead stone was captured, so the count needs no dead stones.
  it.each(['390115.sgf', '403788.sgf', '42896.sgf', '471085.sgf'])('%s: our count matches the recorded result', (file) => {
    const g = read(join('gnugo/cgos', file));
    const end = replaySgf(g);
    expect(end.phase).toBe('scoring');
    expect(estimateDead(end)).toEqual([]);
    const s = score(end);
    expect(s.black - s.white).toBe(recorded(g));
  });

  // These ended when a program tried a move the server refused, naming it in a comment; the Chinese rules refuse it too.
  it.each([
    ['37169.sgf', 'J5', 'ko'],
    ['58273.sgf', 'C9', 'ko'],
    ['60311.sgf', 'A1', 'suicide'],
    ['994.sgf', 'G5', 'ko'],
  ])('%s: we refuse the move the server refused, %s, as %s', (file, name, reason) => {
    const g = read(join('gnugo/cgos', file));
    const end = replaySgf(g);
    const last = g.moves[g.moves.length - 1].color;
    const r = play({ ...end, toPlay: last === 'black' ? 'white' : 'black' }, pointFromName(g.size, name));
    expect(r).toEqual({ ok: false, reason });
  });
});

describe('tournament games under area rules, with dead stones left on the board', () => {
  // Our dead-stone guess plus the area count give the recorded result in each of these.
  it.each(files('gnugo/area'))('%s', (file) => {
    const g = read(join('gnugo/area', file));
    const end = replaySgf(g);
    expect(end.phase).toBe('scoring');
    const s = score(setDead(end, estimateDead(end)));
    expect(s.black - s.white).toBe(recorded(g));
  });

  // The app guesses with fewer playouts than the bot thinks with, so the phone answers at once.
  it.each(files('gnugo/area'))('%s, with the playouts the app uses', (file) => {
    const g = read(join('gnugo/area', file));
    const end = replaySgf(g);
    const s = score(setDead(end, estimateDead(end, { playouts: deadEstimatePlayouts(end.size) })));
    expect(s.black - s.white).toBe(recorded(g));
  });
});

describe('the dead-stone guess after a pass', () => {
  it('doubts a group that could still live or die, though one side is far ahead', () => {
    // Olympiad 2006, GNU Go against Jimmy, cut off after 31 moves: White passes with Black 14½ ahead
    // and only two points open, but a group's fate is still open.
    const g = read(join('gnugo/area', 'olympiad2006-9x9-gnu-jimmy.sgf'));
    const state = pass(replaySgf({ ...g, moves: g.moves.slice(0, 31) }));
    expect(guessDead(state, { playouts: 300 }).unsure).not.toEqual([]);
  });
});

describe('superko', () => {
  // Japanese rules only forbid retaking a ko at once, so these games went on.
  it('gnugo-gorimu.sgf: move 381 would make White face the board of eight moves earlier again, which the Chinese rules forbid', () => {
    // The game was given W+Repetition.
    expect(() => replaySgf(read(join('gnugo/superko', 'gnugo-gorimu.sgf')))).toThrow(/^move 381 \(.*\): ko$/);
  });

  it('filllib10.sgf: move 237 repeats the board of three moves earlier with the other player to move, which the Chinese rules allow', () => {
    const g = read(join('gnugo/superko', 'filllib10.sgf'));
    expect(replaySgf(g).moves).toHaveLength(g.moves.length);
  });
});
