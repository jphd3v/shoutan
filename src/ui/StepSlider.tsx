import { useRef, useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

const THUMB = 28;

/**
 * A slider that stops on whole steps from 1 to `steps`, for a choice that reads as "more or less"
 * rather than as named options. Tap a stop or slide along the track. Screen readers adjust it one step
 * at a time; each stop has a test ID (`<testID>-3`) at its place on the track for UI tests to tap.
 */
export function StepSlider(p: {
  value: number;
  steps: number;
  onChange: (v: number) => void;
  /** Words at the two ends, such as "Easier" and "Harder". */
  ends: [string, string];
  /** A stop worth pointing out, with a word under it. */
  mark?: { at: number; label: string };
  /** What a screen reader says for the value. */
  valueText: string;
  label: string;
  testID: string;
}) {
  const track = useRef<View>(null);
  const [box, setBox] = useState({ left: 0, width: 0 });
  const span = Math.max(1, box.width - THUMB);
  const xOf = (step: number) => THUMB / 2 + ((step - 1) / (p.steps - 1)) * span;
  const clamp = (v: number) => Math.min(p.steps, Math.max(1, v));

  // The finger's page position, against the track's measured place: locationX is relative to whatever
  // view is under the finger.
  const follow = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.pageX - box.left - THUMB / 2;
    const step = clamp(Math.round((x / span) * (p.steps - 1)) + 1);
    if (step !== p.value) p.onChange(step);
  };

  return (
    <View>
      <View style={styles.ends}>
        <Text style={styles.end}>{p.ends[0]}</Text>
        <Text style={styles.end}>{p.ends[1]}</Text>
      </View>
      <View
        ref={track}
        testID={p.testID}
        style={styles.track}
        onLayout={(e) => {
          const width = e.nativeEvent.layout.width;
          track.current?.measure((_x, _y, _w, _h, pageX) => setBox({ left: pageX, width }));
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={follow}
        onResponderMove={follow}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={p.label}
        accessibilityValue={{ min: 1, max: p.steps, now: p.value, text: p.valueText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => p.onChange(clamp(p.value + (e.nativeEvent.actionName === 'increment' ? 1 : -1)))}
      >
        <View style={[styles.line, { left: THUMB / 2, right: THUMB / 2 }]} />
        <View style={[styles.line, styles.filled, { left: THUMB / 2, width: xOf(p.value) - THUMB / 2 }]} />
        {Array.from({ length: p.steps }, (_, i) => i + 1).map((step) => (
          <View key={step} testID={`${p.testID}-${step}`} pointerEvents="none" style={[styles.stop, { left: xOf(step) - STOP_HIT / 2 }]}>
            <View style={[styles.dot, step <= p.value && styles.dotOn]} />
          </View>
        ))}
        <View pointerEvents="none" style={[styles.thumb, { left: xOf(p.value) - THUMB / 2 }]} />
      </View>
      <View style={styles.marks}>
        {p.mark && box.width > 0 && (
          <>
            <Text style={[styles.caret, { left: xOf(p.mark.at) - CARET / 2 }]}>▲</Text>
            <Text style={[styles.mark, markPlace(xOf(p.mark.at) - MARK_WIDTH / 2, box.width - MARK_WIDTH)]} numberOfLines={1}>
              {p.mark.label}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const STOP_HIT = 36;

/** Centred under its stop, or held against the end it would run past. */
const markPlace = (left: number, most: number) =>
  left < 0
    ? { left: 0, textAlign: 'left' as const }
    : left > most
      ? { left: most, textAlign: 'right' as const }
      : { left, textAlign: 'center' as const };
const MARK_WIDTH = 120;
const CARET = 12;

const styles = StyleSheet.create({
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  end: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 15 },
  track: { height: 48, justifyContent: 'center' },
  line: { position: 'absolute', height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken },
  filled: { backgroundColor: colors.accentSoft },
  stop: { position: 'absolute', width: STOP_HIT, height: 48, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.accent },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  marks: { height: 32 },
  caret: { position: 'absolute', top: -4, width: CARET, textAlign: 'center', color: colors.accent, fontSize: 10 },
  mark: {
    position: 'absolute',
    top: 10,
    width: MARK_WIDTH,
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
});
