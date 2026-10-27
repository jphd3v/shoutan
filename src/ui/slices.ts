import { useEffect, useRef, useState } from 'react';
import { deadFrom, openPointsFrom, Playouts, Search } from '../go/ai';
import { isEarly, passCheckPlayouts, passIsEarly } from '../go/guide';
import type { GameState } from '../go/rules';
import { deadFromNet, decide, encode, read } from '../go/katago';
import { Action, botLevel, BotLevel, botNetOf, deadEstimatePlayouts, isAiTurn, Session } from '../go/session';
import { BOT_NET, evaluateNet, HUMAN_NET, humanNetAvailable, preloadNet } from '../../modules/go-net';
import { humanLooseness, humanMeta, humanStyleAt, withHumanMoves } from '../go/human';

/** Playouts run a few at a time until they are done. */
interface Sliced {
  readonly finished: boolean;
  run(count: number): void;
}

const SLICE_MS = 30;

/**
 * Runs the playouts `make` sets up in short slices from timers, so animations and taps stay smooth
 * through seconds of playouts on a phone, then hands them to `done`. Setting up happens in the first
 * slice too. Returns the cancel, for an effect's cleanup.
 */
export function runInSlices<W extends Sliced>(make: () => W, done: (work: W) => void, delay = 0): () => void {
  let work: W | null = null;
  let timer = setTimeout(function step() {
    const sliceEnd = Date.now() + SLICE_MS;
    work ??= make();
    while (!work.finished && Date.now() < sliceEnd) work.run(10);
    if (work.finished) done(work);
    else timer = setTimeout(step, 0);
  }, delay);
  return () => clearTimeout(timer);
}

/**
 * The bot's move, and the likely dead stones after two passes, for the game on this phone. Both wait
 * while an online game is on screen (`paused`); the network finds the same move later. `botStuck`
 * says the network couldn't answer in the position on screen, as on a phone it can't run on.
 */
export function useSessionWork(session: Session, dispatch: (a: Action) => void, paused: boolean): { botStuck: boolean } {
  const level = session.settings.opponent === 'ai' ? botLevel(session.settings) : null;
  const vsBot = level !== null;
  const [stuck, setStuck] = useState<Session | null>(null);
  const human = level !== null && humanStyleFor(session, level) !== null;
  useEffect(() => {
    if (vsBot) void preloadNet(BOT_NET);
    if (human) void preloadNet(HUMAN_NET);
  }, [vsBot, human]);
  useEffect(() => {
    if (paused || level === null || !isAiTurn(session)) return;
    return netMove(session, level, dispatch, () => setStuck(session));
  }, [session, dispatch, paused, level]);
  useEffect(() => {
    if (paused || !session.guessing) return;
    return vsBot ? netDeadGuess(session.game, dispatch) : playoutDeadGuess(session.game, dispatch);
  }, [session, dispatch, paused, vsBot]);
  return { botStuck: stuck === session };
}

const playoutDeadGuess = (game: GameState, dispatch: (a: Action) => void) =>
  runInSlices(
    () => new Playouts(game, { playouts: deadEstimatePlayouts(game.size) }),
    (playouts) => dispatch({ type: 'deadGuessed', ...deadFrom(playouts) }),
  );

/**
 * Against a network level the dead stones come from the network, which judged the bot's pass, rather
 * than from playouts, which are unreliable while much of the board is open. Returns the cancel.
 */
function netDeadGuess(game: GameState, dispatch: (a: Action) => void): () => void {
  let cancelled = false;
  let fallback: (() => void) | null = null;
  evaluateNet(BOT_NET, game.size, encode(game))
    .then((out) => !cancelled && dispatch({ type: 'deadGuessed', ...deadFromNet(game, read(game.size, out)) }))
    .catch(() => {
      if (!cancelled) fallback = playoutDeadGuess(game, dispatch);
    });
  return () => {
    cancelled = true;
    fallback?.();
  };
}

/** The human-like style the bot plays, or null when it plays KataGo: by the player's choice, or on a phone that can't run it. */
const humanStyleFor = (session: Session, level: BotLevel) =>
  humanNetAvailable && botNetOf(session.settings) === 'human' ? humanStyleAt(session.game.size, level) : null;

/** The bot's move: the network reads the position on a native thread. Returns the cancel. */
function netMove(session: Session, level: BotLevel, dispatch: (a: Action) => void, failed: () => void): () => void {
  const game = session.game;
  let cancelled = false;
  const started = Date.now();
  const style = humanStyleFor(session, level);
  const inputs = encode(game);
  const reading = style
    ? Promise.all([
        evaluateNet(BOT_NET, game.size, inputs),
        evaluateNet(HUMAN_NET, game.size, inputs, humanMeta(style.inverse, game.size)),
      ]).then(([judge, human]) => withHumanMoves(read(game.size, judge), read(game.size, human)))
    : evaluateNet(BOT_NET, game.size, inputs).then((out) => read(game.size, out));
  reading
    .then((r) => {
      const decision = style ? decide(game, r, level, humanLooseness(style)) : decide(game, r, level);
      // A short pause, so the reply doesn't land under the player's finger.
      setTimeout(() => !cancelled && dispatch({ type: 'ai', decision }), Math.max(0, 250 - (Date.now() - started)));
    })
    .catch(() => !cancelled && failed());
  return () => {
    cancelled = true;
  };
}

/**
 * Passing with much of the board open asks for a second tap, so a beginner doesn't end the game by
 * accident. Whether a pass would be early is worked out in slices while the player thinks, so tapping
 * Pass doesn't stall. `gameKey` changes when another game is shown.
 */
export function usePassWarning(game: GameState, canPlay: boolean, gameKey: string) {
  const passCheck = useRef<{ game: GameState; early: boolean } | null>(null);
  useEffect(() => {
    if (game.phase !== 'playing' || !canPlay) return;
    return runInSlices(
      () => new Search(game, { playouts: passCheckPlayouts(game.size) }),
      (search) => {
        passCheck.current = { game, early: isEarly(game, openPointsFrom(search)) };
      },
    );
  }, [game, canPlay]);
  const [warnedAt, setWarnedAt] = useState<string | null>(null);
  const passKey = `${gameKey}:${game.moves.length}`;
  const passOrWarn = (pass: () => void) => {
    const early = passCheck.current?.game === game ? passCheck.current.early : passIsEarly(game);
    if (warnedAt !== passKey && early) {
      setWarnedAt(passKey);
      return;
    }
    setWarnedAt(null);
    pass();
  };
  return { warned: warnedAt === passKey, passOrWarn };
}
