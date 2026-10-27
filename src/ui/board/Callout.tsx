import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { Color } from '../../go/rules';
import { colors, fonts, radius } from '../theme';
import { BOARD_EDGE } from './geometry';

const CALLOUT_W = 340;
export const CALLOUT_H = 64;
/** A rising note waits this long on the spot before floating up above the board. */
const RISE_DELAY_MS = 700;
const RISE_MS = 700;
/** After rising, a note stays only briefly so it does not cover the text beside the board. */
const RISE_HOLD_MS = 500;
const FADE_MS = 300;

/**
 * A label over the points it is about. Two kinds, and they move differently on purpose:
 * - A note about a moment of play (a capture, a ko; `rise`) floats off the board toward its reader
 *   and fades: the game goes on, so it clears the stones for the next move.
 * - A label for what the board shows now (a count step such as "+12 territory", the liberties of a
 *   held stone; no `rise`) stays over its points as long as that is shown, and is replaced by the
 *   next one: the count can be paused and stepped back, so its label must not leave.
 * Count labels ease in at a small size, including neutral steps that concern both players.
 * Other neutral notes are larger and spring in. `flip` turns it upside down for a player across the table.
 */
export function Callout({
  label,
  color,
  x,
  y,
  still,
  bounds,
  rise,
  flip = false,
  counting = false,
}: {
  label: string;
  color: Color | null;
  x: number;
  y: number;
  still: boolean;
  bounds: number;
  rise?: 'up' | 'down';
  flip?: boolean;
  counting?: boolean;
}) {
  const calm = counting || color !== null;
  const t = useRef(new Animated.Value(still ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const top = Math.max(0, Math.min(bounds - CALLOUT_H, y - CALLOUT_H / 2));
  // From where it appeared to just above the board's top edge, or just below its wooden edge.
  const travel = rise === 'down' ? bounds + BOARD_EDGE + 4 - top : -CALLOUT_H - 4 - top;
  useEffect(() => {
    if (still) {
      if (rise) lift.setValue(1);
      return;
    }
    const pop = !calm
      ? Animated.spring(t, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true })
      : Animated.timing(t, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    const stay = [
      Animated.delay(RISE_DELAY_MS),
      Animated.timing(lift, { toValue: 1, duration: RISE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.delay(RISE_HOLD_MS),
    ];
    const anim = rise
      ? Animated.parallel([
          pop,
          Animated.sequence([...stay, Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true })]),
        ])
      : pop;
    anim.start();
    return () => anim.stop();
  }, [t, lift, fade, still, rise, calm]);
  return (
    <View pointerEvents="none" style={[styles.calloutAnchor, { left: Math.max(0, Math.min(bounds - CALLOUT_W, x - CALLOUT_W / 2)), top }]}>
      <Animated.View
        style={[
          styles.callout,
          color === null ? styles.calloutNeutral : color === 'black' ? styles.calloutBlack : styles.calloutWhite,
          calm && styles.calloutPlayer,
          {
            opacity: Animated.multiply(t, fade),
            transform: [
              {
                translateY: Animated.add(
                  t.interpolate({ inputRange: [0, 1], outputRange: [calm ? 5 : 8, 0] }),
                  lift.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }),
                ),
              },
              { rotate: flip ? '180deg' : '0deg' },
              { scale: t.interpolate({ inputRange: [0, 1], outputRange: [calm ? 0.92 : 0.7, 1] }) },
            ],
          },
        ]}
      >
        <Text
          style={[
            styles.calloutText,
            calm && styles.calloutTextPlayer,
            { color: color === null ? colors.noteInk : color === 'white' ? '#1A1A1A' : colors.text },
          ]}
          numberOfLines={2}
          testID="count-callout"
        >
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  calloutAnchor: { position: 'absolute', width: CALLOUT_W, height: CALLOUT_H, alignItems: 'center', justifyContent: 'center' },
  callout: {
    maxWidth: CALLOUT_W,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(242, 169, 59, 0.7)',
  },
  calloutPlayer: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  calloutBlack: { backgroundColor: 'rgba(22, 20, 18, 0.8)', borderColor: 'rgba(255, 255, 255, 0.14)' },
  calloutNeutral: {
    backgroundColor: colors.note,
    borderColor: colors.noteEdge,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  calloutWhite: { backgroundColor: 'rgba(250, 247, 240, 0.86)', borderColor: 'rgba(20, 20, 20, 0.12)' },
  calloutText: { fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
  calloutTextPlayer: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
});
