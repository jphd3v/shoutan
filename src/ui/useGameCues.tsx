import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import type { Color, GameState } from '../go/rules';
import { cueFor } from './cues';
import { haptic } from './haptics';
import { t } from './i18n';
import { useReduceMotion } from './motion';
import { play } from './sound';
import { colors, fonts, radius } from './theme';

/**
 * A short note over the board; `warning` for a refused move. `detail`, a smaller second line, makes it the
 * larger card that stays a little longer, for the end of play.
 */
export type Note = { id: number; text: string; warning?: boolean; detail?: string };

/**
 * Plays the sounds and haptics for each change of the game, and returns what the screen
 * shows around the board: a shake and a note saying why for refused moves, and a note when someone passes
 * (or, when that pass ends play, that the game is over).
 */
export function useGameCues(
  game: GameState,
  ctx: {
    /** A new object for every refused move, null otherwise. */
    refusal?: object | null;
    /** Identifies the game shown; when it changes (opening another game), nothing plays. */
    gameKey?: string;
    viewer: Color | null;
    chimeForOpponent?: boolean;
    /** The board counts a scored result first; the caller plays `resultCue` when it ends. */
    deferResult?: boolean;
    /** The latest change took a move back. */
    undone?: boolean;
    /** The note when a player passes, e.g. "Black passed". */
    passedText: (c: Color) => string;
    /** Why the latest move was refused, e.g. "There’s already a stone there." */
    refusedText?: () => string | null;
  },
) {
  const reduceMotion = useReduceMotion();
  const previous = useRef({ game, refusal: ctx.refusal ?? null, key: ctx.gameKey });
  const shake = useRef(new Animated.Value(0)).current;
  const [note, setNote] = useState<Note | null>(null);
  const { refusal = null, viewer, chimeForOpponent, gameKey, deferResult, undone } = ctx;
  const passedText = useRef(ctx.passedText);
  passedText.current = ctx.passedText;
  const refusedText = useRef(ctx.refusedText);
  refusedText.current = ctx.refusedText;

  useEffect(() => {
    const before = previous.current;
    previous.current = { game, refusal, key: gameKey };
    // A note belongs to its game: kept, a board note mounted later (another layout) would show it again.
    const newGame = before.key !== gameKey || (game.moves.length === 0 && before.game.moves.length > 0);
    if (newGame) setNote(null);
    if (before.key !== gameKey) return;
    const refused = refusal !== null && refusal !== before.refusal;
    const cue = cueFor(before.game, game, { refused, viewer, chimeForOpponent, deferResult, undone });
    if (!cue) return;
    for (const s of cue.sounds) {
      if (s.delay === 0) play(s.name);
      else setTimeout(() => play(s.name), s.delay);
    }
    if (cue.haptic) void haptic(cue.haptic);
    if (cue.shake && !reduceMotion) {
      shake.setValue(0);
      Animated.sequence([10, -8, 6, -4, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 45, useNativeDriver: true }))).start();
    }
    const passed = cue.passed;
    if (passed)
      setNote((n) => ({
        id: (n?.id ?? 0) + 1,
        ...(cue.ended ? { text: t('Game over'), detail: t('Both players passed') } : { text: passedText.current(passed) }),
      }));
    const why = refused ? refusedText.current?.() : null;
    if (why) setNote((n) => ({ id: (n?.id ?? 0) + 1, text: why, warning: true }));
  }, [game, refusal, viewer, chimeForOpponent, gameKey, deferResult, undone, reduceMotion, shake]);

  return { shakeStyle: { transform: [{ translateX: shake }] }, note };
}

/**
 * A short note over the board, for example "Black passed", that floats up and fades away;
 * `flip` turns it upside down for a player across the table, and `place` puts it in one half of the
 * board when each player gets a copy.
 */
export function BoardNote({ note, flip = false, place }: { note: Note | null; flip?: boolean; place?: 'low' | 'high' }) {
  const reduceMotion = useReduceMotion();
  const shown = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!note) return;
    shown.setValue(reduceMotion ? 1 : 0);
    lift.setValue(0);
    fade.setValue(1);
    // The end of play stays in place long enough to read, and to turn the phone between two players.
    const card = !!note.detail;
    if (reduceMotion) {
      Animated.sequence([
        Animated.delay(card ? 2400 : 1200),
        Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
      return;
    }
    const pop = Animated.spring(shown, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true });
    const anim = Animated.parallel([
      pop,
      Animated.sequence(
        card
          ? [Animated.delay(2000), Animated.timing(fade, { toValue: 0, duration: 450, useNativeDriver: true })]
          : [
              Animated.delay(600),
              Animated.timing(lift, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
              Animated.delay(400),
              Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }),
            ],
      ),
    ]);
    anim.start();
    return () => anim.stop();
  }, [note, shown, lift, fade, reduceMotion]);

  if (!note) return null;

  const travel = flip ? 36 : -36;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.note,
        place === 'low' && styles.noteLow,
        place === 'high' && styles.noteHigh,
        note.warning && styles.noteWarning,
        note.detail && styles.card,
        {
          opacity: Animated.multiply(shown, fade),
          transform: [
            {
              translateY: Animated.add(
                shown.interpolate({ inputRange: [0, 1], outputRange: [flip ? -8 : 8, 0] }),
                lift.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }),
              ),
            },
            { rotate: flip ? '180deg' : '0deg' },
            { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) },
          ],
        },
      ]}
      testID={flip && place ? 'board-note-top' : 'board-note'}
      accessibilityLiveRegion={flip && place ? 'none' : 'polite'}
      importantForAccessibility={flip && place ? 'no-hide-descendants' : 'auto'}
    >
      <Text style={[styles.noteText, note.detail && styles.cardTitle]}>{note.text}</Text>
      {note.detail && <Text style={styles.cardDetail}>{note.detail}</Text>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  note: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.note,
    borderWidth: 1,
    borderColor: colors.noteEdge,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  noteLow: { top: '62%' },
  noteHigh: { top: '22%' },
  noteWarning: { backgroundColor: colors.danger },
  noteText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.noteInk,
    textAlign: 'center',
  },
  card: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: radius.lg },
  cardTitle: { fontFamily: fonts.heavy, fontSize: 24, lineHeight: 30 },
  cardDetail: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, color: colors.noteInk, textAlign: 'center', opacity: 0.8 },
});
