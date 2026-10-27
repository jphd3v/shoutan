import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Color } from '../go/rules';
import { t } from './i18n';
import { useReduceMotion } from './motion';
import { Stone } from './Stone';
import { ThinkingDots } from './ThinkingDots';
import { colors, fonts } from './theme';

/**
 * A player's name and count, with an optional profile shortcut on their avatar. The disc on the left holds the
 * player's avatar, or their stone without one (face to face); a ring around it marks the player to move, so the
 * screen needs no separate turn line. Their colour shows once while playing: in the disc, or beside the name as a
 * small stone when the disc holds an avatar. Once the score is counted the territory's swatch sits beside the name.
 */
export function PlayerCard({
  color,
  name,
  avatar,
  active,
  thinking,
  label,
  value,
  secondary,
  swatch,
  estimate,
  onStonePage,
  onAvatar,
  avatarLabel,
}: {
  /** Opens what the picture leads to: the player's own profile, or what is known about the opponent. */
  onAvatar?: () => void;
  /** What tapping the picture opens, for screen readers; the profile by default. */
  avatarLabel?: string;
  color: Color;
  name: string;
  /** An emoji; null shows the player's stone in the disc. */
  avatar: string | null;
  active: boolean;
  /** Dots after the name while this player's move is on its way (the bot, an online opponent). */
  thinking?: boolean;
  /** Nothing while playing under area scoring, where captures don't change the score; the score once counted. */
  label?: string;
  value?: string;
  /** A count kept while playing (captures, under territory scoring): shown quieter than a score, which decides the game. */
  secondary: boolean;
  /** The colour of this player's territory on the board, when it is shown in colour. */
  swatch?: string;
  /** The score the game seems headed for, and whether it puts this player ahead. */
  estimate?: { value: string; leading: boolean } | null;
  /** Reports the page position of the colour beside the name, where captured stones land. */
  onStonePage: (at: { x: number; y: number }) => void;
}) {
  const reduceMotion = useReduceMotion();
  // The value bumps when it changes (a capture, the count).
  const bump = useRef(new Animated.Value(1)).current;
  const shown = useRef(value);
  const markRef = useRef<View>(null);
  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    if (reduceMotion) return;
    bump.setValue(1.35);
    Animated.spring(bump, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [value, bump, reduceMotion]);
  const labelText = `${name}${value !== undefined ? `, ${label} ${value}` : ''}${estimate ? t(', about {n} points', { n: estimate.value }) : ''}${estimate?.leading ? t(', leading') : ''}${active ? t(', to play') : ''}`;
  const stoneInDisc = avatar === null;
  // Captured stones land on the player's colour, wherever it shows.
  const measureColour = () => markRef.current?.measure((_x, _y, w, h, px, py) => onStonePage({ x: px + w / 2, y: py + h / 2 }));
  const disc = (
    <View
      ref={stoneInDisc ? markRef : undefined}
      onLayout={stoneInDisc ? measureColour : undefined}
      style={[styles.cardStone, active && styles.cardStoneActive]}
      testID={active ? `turn-${color}` : undefined}
    >
      {stoneInDisc ? (
        <View style={styles.discStone} testID={`disc-stone-${color}`}>
          <Stone color={color} size={28} />
        </View>
      ) : (
        <View style={styles.avatarDisc}>
          <Text style={styles.avatar} testID={`avatar-${color}`} importantForAccessibility="no">
            {avatar}
          </Text>
        </View>
      )}
    </View>
  );
  return (
    <View
      style={styles.card}
      testID={`player-${color}`}
      accessible={!onAvatar}
      accessibilityLabel={labelText}
      accessibilityLiveRegion={active && !onAvatar ? 'polite' : 'none'}
    >
      {onAvatar ? (
        <Pressable
          onPress={onAvatar}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={avatarLabel ?? t('Profile')}
          testID={`profile-${color}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          {disc}
        </Pressable>
      ) : (
        disc
      )}
      <View
        style={styles.cardText}
        accessible={!!onAvatar}
        accessibilityLabel={onAvatar ? labelText : undefined}
        accessibilityLiveRegion={active && onAvatar ? 'polite' : 'none'}
      >
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardName, active && styles.cardNameActive]} numberOfLines={1}>
            {name}
          </Text>
          {swatch ? (
            <View style={[styles.swatch, { backgroundColor: swatch }]} testID={`swatch-${color}`} />
          ) : (
            !stoneInDisc && (
              <View ref={markRef} onLayout={measureColour} style={styles.mark} testID={`mark-${color}`}>
                <Stone color={color} size={16} />
              </View>
            )
          )}
          {thinking && <ThinkingDots />}
        </View>
        <Animated.View style={[styles.cardDetailRow, { transform: [{ scale: bump }] }]}>
          {value !== undefined && (
            <Text style={styles.cardDetail} testID={`detail-${color}`} numberOfLines={1}>
              {label}: <Text style={secondary ? styles.cardValueQuiet : styles.cardValue}>{value}</Text>
            </Text>
          )}
          {/* Its own text, so on a narrow card (face to face, beside the buttons) it moves to the next line instead of being cut off. */}
          {estimate && (
            <Text style={estimate.leading ? styles.estimateLeading : styles.estimate} testID={`estimate-${color}`} numberOfLines={1}>
              {`≈ ${estimate.value}`}
            </Text>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

/** Holds back increases of a counter until `delay` has passed; decreases (undo, new game) show at once. */
export function useLanded<T extends Record<string, number>>(value: T, delay: number): T {
  const [shown, setShown] = useState(value);
  const latest = useRef(shown);
  latest.current = shown;
  useEffect(() => {
    const grew = Object.keys(value).some((k) => value[k] > latest.current[k]);
    if (!grew || delay === 0) {
      setShown(value);
      return;
    }
    const timer = setTimeout(() => setShown(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return shown;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  // The ring is always there, transparent when idle, so the card does not move as turns change.
  cardStone: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardStoneActive: { borderColor: colors.accent },
  avatarDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { fontSize: 19, lineHeight: 24, textAlign: 'center' },
  cardText: { flex: 1 },
  cardName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textMuted, flexShrink: 1 },
  cardNameActive: { fontFamily: fonts.heavy, color: colors.text },
  cardDetailRow: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 12,
    marginTop: 1,
    // Kept when empty, so the board doesn't move when the score appears.
    minHeight: 19,
  },
  cardDetail: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted },
  cardValue: { fontFamily: fonts.bold, fontSize: 14, color: colors.accent },
  cardValueQuiet: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textMuted },
  estimate: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textMuted },
  estimateLeading: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The stone draws itself absolutely, a little larger than its size for the shadow: this box gives it its place.
  mark: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  discStone: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1, borderColor: colors.textMuted },
});
