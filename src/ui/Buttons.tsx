import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, ReactElement, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from './theme';
import { t } from './i18n';
import { useReduceMotion } from './motion';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface ButtonProps {
  label: string;
  onPress: () => void;
  testID: string;
  icon?: IconName;
  /** `quiet` is outlined, for game controls that should not draw the eye from the board. */
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
  flex?: boolean;
  /** See `Nudge`. */
  nudge?: number | null;
}

export function Button({ label, onPress, testID, icon, variant = 'secondary', disabled, flex, nudge }: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <Nudge after={nudge} flex={flex}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        style={({ pressed }) => [
          styles.button,
          // Wrapped for a nudge, the wrapper takes the row's width and the button fills it.
          flex && nudge === undefined && { flex: 1 },
          primary ? styles.primary : variant === 'quiet' ? styles.quiet : styles.secondary,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {icon && <Ionicons name={icon} size={19} color={primary ? colors.accentInk : colors.accent} />}
        <Text style={[styles.label, { color: primary ? colors.accentInk : colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </Text>
      </Pressable>
    </Nudge>
  );
}

/** A round icon-only button for the header; `label` is read by screen readers. */
export function IconButton({
  label,
  icon,
  onPress,
  testID,
  size = 42,
  disabled,
  quiet,
  nudge,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  testID: string;
  size?: number;
  disabled?: boolean;
  /** Outlined, like a quiet `Button`. */
  quiet?: boolean;
  /** See `Nudge`. */
  nudge?: number | null;
}) {
  return (
    <Nudge after={nudge}>
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        hitSlop={6}
        style={({ pressed }) => [
          styles.iconButton,
          { width: size, height: size },
          quiet && styles.quiet,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name={icon} size={20} color={colors.accent} />
      </Pressable>
    </Nudge>
  );
}

const NUDGE_GAP_MS = 4500;

/**
 * Draws the eye to the button the status line names ("tap Count"): `after` milliseconds, then it hops,
 * twice more a few seconds apart, and rests. `null` keeps it still; `undefined` (a button that is never
 * nudged) leaves the button unwrapped. Still with reduce motion.
 */
function Nudge({ after, flex, children }: { after: number | null | undefined; flex?: boolean; children: ReactElement }) {
  const reduceMotion = useReduceMotion();
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (after == null || reduceMotion) return;
    const hop = Animated.sequence([
      Animated.timing(y, { toValue: -7, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(y, { toValue: 0, friction: 3.5, tension: 180, useNativeDriver: true }),
      Animated.delay(NUDGE_GAP_MS),
    ]);
    const anim = Animated.sequence([Animated.delay(after), Animated.loop(hop, { iterations: 3 })]);
    anim.start();
    return () => {
      anim.stop();
      y.setValue(0);
    };
  }, [after, reduceMotion, y]);
  if (after === undefined) return children;
  return <Animated.View style={[flex && { flex: 1 }, { transform: [{ translateY: y }] }]}>{children}</Animated.View>;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: IconName; testID: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.testID}
            testID={o.testID}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            {o.icon && <Ionicons name={o.icon} size={17} color={selected ? colors.accent : colors.textMuted} />}
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** An on/off choice that stands on its own, drawn as a tick box so it never reads as part of a group. */
export function Checkbox({
  label,
  checked,
  onChange,
  testID,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  testID: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      testID={testID}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={disabled ? { checked, disabled } : { checked }}
      accessibilityLabel={`${label} ${checked ? t('on') : t('off')}`}
      hitSlop={6}
      style={({ pressed }) => [styles.checkbox, checked && styles.checkboxChecked, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={19} color={checked ? colors.accent : colors.textMuted} />
      <Text style={[styles.checkboxLabel, checked && styles.checkboxLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  primary: {
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  secondary: { backgroundColor: colors.surfaceRaised },
  quiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  // Shares the row's free width, so the name fits on narrow phones and in longer languages.
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  label: { fontFamily: fonts.bold, fontSize: 16, flexShrink: 1, textAlign: 'center' },
  iconButton: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
  },
  segmentSelected: { backgroundColor: colors.surfaceRaised },
  segmentLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.textMuted, textAlign: 'center', flexShrink: 1 },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  checkboxChecked: { backgroundColor: colors.accentSoft },
  checkboxLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.textMuted },
  checkboxLabelOn: { color: colors.text, fontFamily: fonts.bold },
  segmentLabelSelected: { color: colors.accent, fontFamily: fonts.bold },
});
