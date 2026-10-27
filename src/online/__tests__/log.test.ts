import { deadFrom, Playouts } from '../../go/ai';
import { pass, pointFromName } from '../../go/rules';
import { deadEstimatePlayouts } from '../../go/session';
import { sha256 } from '../sha256';
import {
  applyEvent,
  extend,
  GameEvent,
  GameMeta,
  genesis,
  OnlineGame,
  parseEvent,
  replay,
  RULES_VERSION,
  seal,
  SealedEvent,
  startOnline,
  summary,
} from '../log';

const meta: GameMeta = { id: 'game-1', size: 9, komi: 7.5, rulesVersion: RULES_VERSION, handicap: 0 };
const pt = (name: string) => pointFromName(9, name);

/** Seals actions one by one as the acting phone would, throwing if the rules refuse one. */
function play(...actions: GameEvent[]): OnlineGame {
  let s = startOnline(meta);
  for (const a of actions) {
    const r = seal(s, a);
    if (!r.ok) throw new Error(`${a.kind} refused: ${r.reason}`);
    s = r.state;
  }
  return s;
}

const toScoring: GameEvent[] = [
  { kind: 'play', color: 'black', point: pt('E5') },
  { kind: 'play', color: 'white', point: pt('A1') },
  { kind: 'pass', color: 'black' },
  { kind: 'pass', color: 'white' },
];

describe('online event log', () => {
  it('a replay on the other phone reaches the same state and head', () => {
    const s = play(
      { kind: 'play', color: 'black', point: pt('E5') },
      { kind: 'play', color: 'white', point: pt('C3') },
      { kind: 'pass', color: 'black' },
    );
    const r = replay(meta, s.events);
    expect(r.ok).toBe(true);
    expect(r.state.head).toBe(s.head);
    expect(r.state.game.board).toEqual(s.game.board);
    expect(summary(r.state)).toEqual({ status: 'playing', toPlay: 'white', result: null });
  });

  it('chains every event to the one before, starting from the game identity', () => {
    const s = play({ kind: 'play', color: 'black', point: pt('E5') }, { kind: 'pass', color: 'white' });
    expect(s.events[0].prev).toBe(genesis(meta));
    expect(s.events[1].prev).toBe(s.events[0].hash);
    expect(s.head).toBe(s.events[1].hash);
    expect(genesis({ ...meta, id: 'game-2' })).not.toBe(genesis(meta));
    expect(genesis({ ...meta, rulesVersion: RULES_VERSION + 1 })).not.toBe(genesis(meta));
  });

  it('a one-stone game hashes its setup the way the database does, and Black plays first', () => {
    const one: GameMeta = { ...meta, komi: 0.5, handicap: 1 };
    expect(genesis(one)).toBe(sha256(`go-online|rules 4|${meta.id}|${meta.size}|0.5|handicap 1|chinese`));
    const s = startOnline(one);
    expect(s.game).toMatchObject({ toPlay: 'black', komi: 0.5, handicap: 1 });
    expect(s.game.board.every((x) => x === 0)).toBe(true);
    expect(seal(s, { kind: 'play', color: 'white', point: pt('E5') })).toMatchObject({ ok: false, reason: 'notYourTurn' });
  });

  it('a handicap game hashes its setup the way the database does, and starts from it', () => {
    const setup: GameMeta = { ...meta, komi: 3.5, handicap: 3 };
    expect(genesis(setup)).toBe(sha256(`go-online|rules 4|${meta.id}|${meta.size}|3.5|handicap 3|chinese`));
    expect(genesis(setup)).not.toBe(genesis({ ...setup, handicap: 2 }));
    const s = startOnline(setup);
    expect(s.game).toMatchObject({ toPlay: 'white', komi: 3.5, handicap: 3 });
    expect(s.game.board.filter((x) => x !== 0)).toHaveLength(3);
    const r = seal(s, { kind: 'play', color: 'white', point: pt('E5') });
    expect(r.ok).toBe(true);
    if (r.ok) expect(replay(setup, r.state.events).ok).toBe(true);
  });

  it('refuses events the rules forbid, and seals nothing', () => {
    const s = play({ kind: 'play', color: 'black', point: pt('E5') });
    expect(seal(s, { kind: 'play', color: 'white', point: pt('E5') })).toEqual({ ok: false, reason: 'occupied' });
    expect(seal(s, { kind: 'play', color: 'black', point: pt('D4') })).toEqual({ ok: false, reason: 'notYourTurn' });
    expect(seal(s, { kind: 'accept', color: 'white' })).toEqual({ ok: false, reason: 'notScoring' });
  });

  describe('detects a phone that sends something else than the rules produce', () => {
    const honest = play({ kind: 'play', color: 'black', point: pt('E5') }, { kind: 'play', color: 'white', point: pt('C3') });
    const [first, second] = honest.events;
    /** The second move, played elsewhere but keeping its original hashes. */
    const moved = { ...second, point: pt('G7') } as SealedEvent;

    it('an illegal move with a self-consistent hash', () => {
      const forged: SealedEvent = { kind: 'play', color: 'white', point: pt('E5'), prev: first.hash, hash: second.hash };
      expect(replay(meta, [first, forged])).toMatchObject({ ok: false, index: 1, reason: 'occupied' });
    });

    it('a changed point, with the original hash', () => {
      expect(replay(meta, [first, moved])).toMatchObject({ ok: false, index: 1, reason: 'hashMismatch' });
    });

    it('an event that skips or reorders the chain', () => {
      expect(replay(meta, [second])).toMatchObject({ ok: false, index: 0, reason: 'brokenChain' });
      const other = play({ kind: 'play', color: 'black', point: pt('D4') });
      expect(replay(meta, [other.events[0], second])).toMatchObject({ ok: false, index: 1, reason: 'brokenChain' });
    });

    it('events copied from another game', () => {
      expect(replay({ ...meta, id: 'game-2' }, honest.events)).toMatchObject({ ok: false, index: 0, reason: 'brokenChain' });
    });

    it('a different rules version on the other phone', () => {
      expect(replay({ ...meta, rulesVersion: RULES_VERSION + 1 }, honest.events)).toMatchObject({
        ok: false,
        index: 0,
        reason: 'brokenChain',
      });
    });

    it('keeps the state as of the last valid event', () => {
      const r = replay(meta, [first, moved]);
      expect(r.state.events).toEqual([first]);
      expect(r.state.head).toBe(first.hash);
    });
  });

  it('the scoring pass carries the dead-stone suggestion; other passes carry none', () => {
    const s = play(...toScoring);
    expect(s.events[2]).not.toHaveProperty('dead');
    const scoringPass = s.events[3] as Extract<SealedEvent, { kind: 'pass' }>;
    expect(Array.isArray(scoringPass.dead)).toBe(true);
    expect(s.game.phase).toBe('scoring');
    expect([...s.game.dead].sort()).toEqual(scoringPass.dead);
  });

  it('a dead list worked out ahead goes with the scoring pass, the same the pass would guess; other passes drop one', () => {
    const before = play(...toScoring.slice(0, 3));
    const last = toScoring[3] as Extract<GameEvent, { kind: 'pass' }>;
    const guessed = seal(before, last);
    const ahead = seal(before, { ...last, dead: [pt('E5')] });
    if (!guessed.ok || !ahead.ok) throw new Error('refused');
    expect((ahead.event as { dead?: number[] }).dead).toEqual([pt('E5')]);
    // The playouts the app runs in slices ahead give the list the pass would have guessed.
    const playouts = new Playouts(pass(before.game), { playouts: deadEstimatePlayouts(9) });
    playouts.run(playouts.total);
    expect((guessed.event as { dead?: number[] }).dead).toEqual(deadFrom(playouts).dead);
    const early = seal(play(...toScoring.slice(0, 2)), { ...(toScoring[2] as Extract<GameEvent, { kind: 'pass' }>), dead: [pt('E5')] });
    expect(early.ok && early.event).not.toHaveProperty('dead');
  });

  it('refuses dead lists on the wrong pass or naming empty points', () => {
    const before = play(toScoring[0], toScoring[1], toScoring[2]);
    const early = play(toScoring[0], toScoring[1]);
    const bogusEarly = { kind: 'pass' as const, color: 'black' as const, dead: [pt('E5')], prev: early.head, hash: before.head };
    expect(applyEvent(early, bogusEarly)).toEqual({ ok: false, reason: 'badDeadList' });
    const emptyPoint = { kind: 'pass' as const, color: 'white' as const, dead: [pt('J9')], prev: before.head, hash: '0'.repeat(64) };
    expect(applyEvent(before, emptyPoint)).toEqual({ ok: false, reason: 'badDeadList' });
    const missing = { kind: 'pass' as const, color: 'white' as const, prev: before.head, hash: '0'.repeat(64) };
    expect(applyEvent(before, missing)).toEqual({ ok: false, reason: 'badDeadList' });
  });

  it('needs both players to accept the same marks; a new mark clears acceptance', () => {
    let s = play(...toScoring, { kind: 'accept', color: 'black' });
    expect(s.accepted).toEqual({ black: true, white: false });
    expect(seal(s, { kind: 'accept', color: 'black' })).toEqual({ ok: false, reason: 'alreadyAccepted' });

    s = play(...toScoring, { kind: 'accept', color: 'black' }, { kind: 'mark', color: 'white', point: pt('A1') });
    expect(s.accepted).toEqual({ black: false, white: false });

    s = play(...toScoring, { kind: 'accept', color: 'black' }, { kind: 'accept', color: 'white' });
    expect(s.game.phase).toBe('over');
    expect(summary(s)).toEqual({ status: 'over', toPlay: s.game.toPlay, result: s.game.result });
    expect(replay(meta, s.events).state.head).toBe(s.head);
  });

  it('the hash covers the result, so a phone that counts differently is caught', () => {
    const s = play(...toScoring, { kind: 'accept', color: 'black' });
    const honest = seal(s, { kind: 'accept', color: 'white' });
    if (!honest.ok) throw new Error('refused');
    const sneaky = { ...s, game: { ...s.game, komi: 0.5 } };
    const other = seal(sneaky, { kind: 'accept', color: 'white' });
    if (!other.ok) throw new Error('refused');
    expect(applyEvent(s, other.event)).toEqual({ ok: false, reason: 'hashMismatch' });
  });

  it('resume goes back to play; resign ends the game from either phase', () => {
    expect(play(...toScoring, { kind: 'resume', color: 'white' }).game.phase).toBe('playing');
    expect(play({ kind: 'resign', color: 'black' }).game.result).toEqual({ winner: 'white', reason: 'resignation' });
    expect(play(...toScoring, { kind: 'resign', color: 'white' }).game.result).toEqual({ winner: 'black', reason: 'resignation' });
    expect(seal(play({ kind: 'resign', color: 'black' }), { kind: 'pass', color: 'white' })).toEqual({ ok: false, reason: 'gameOver' });
  });

  it('extend applies only new events on top of a verified state', () => {
    const full = play({ kind: 'play', color: 'black', point: pt('E5') }, { kind: 'play', color: 'white', point: pt('C3') });
    const partial = replay(meta, full.events.slice(0, 1));
    expect(extend(partial.state, full.events.slice(1)).state.head).toBe(full.head);
  });

  it('leaves the input state untouched', () => {
    const start = startOnline(meta);
    seal(start, { kind: 'play', color: 'black', point: pt('E5') });
    expect(start.events).toHaveLength(0);
    expect(start.game.moves).toHaveLength(0);
  });
});

describe('parseEvent', () => {
  const h = 'a'.repeat(64);
  const ok = { prev: h, hash: h };

  it('accepts each well-formed kind', () => {
    for (const ev of [
      { kind: 'play', color: 'black', point: 0, ...ok },
      { kind: 'mark', color: 'white', point: 80, ...ok },
      { kind: 'pass', color: 'black', ...ok },
      { kind: 'pass', color: 'black', dead: [1, 2], ...ok },
      { kind: 'resign', color: 'white', ...ok },
      { kind: 'accept', color: 'white', ...ok },
      { kind: 'resume', color: 'black', ...ok },
    ]) {
      expect(parseEvent(ev, 9)).toEqual(ev);
    }
  });

  it('rejects anything else', () => {
    for (const ev of [
      null,
      [],
      'play',
      { kind: 'play', color: 'black', point: 81, ...ok },
      { kind: 'play', color: 'black', point: -1, ...ok },
      { kind: 'play', color: 'black', point: 1.5, ...ok },
      { kind: 'play', color: 'black', point: '3', ...ok },
      { kind: 'play', color: 'green', point: 3, ...ok },
      { kind: 'play', color: 'black', point: 3, extra: 1, ...ok },
      { kind: 'resign', color: 'black', point: 3, ...ok },
      { kind: 'pass', color: 'black', dead: [81], ...ok },
      { kind: 'pass', color: 'black', dead: 'all', ...ok },
      { kind: 'undo', color: 'black', ...ok },
      { kind: 'pass', color: 'black', prev: 'short', hash: h },
      { kind: 'pass', color: 'black', prev: h },
      { kind: 'pass', color: 'black', prev: h, hash: h.toUpperCase() },
    ]) {
      expect(parseEvent(ev, 9)).toBeNull();
    }
  });
});
