import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Color } from '../go/rules';
import type { RankMove } from '../go/rating';
import type { ResultNote } from './copy';
import { ScoreRow, ScoreTable } from './ScoreCount';
import { colors, fonts } from './theme';
import { t } from './i18n';

interface Props {
  title: string;
  subtitle: string;
  /** A line under the subtitle, such as the player's rank after the game. */
  note?: ResultNote | null;
  /** Each player's score, when the game was counted. */
  rows: readonly ScoreRow[] | null;
  /** Back to marking dead stones, when the automatic guess was wrong. */
  onFixDead?: () => void;
  /** Rises in, unless the player has asked for less motion. */
  still: boolean;
  /** Smaller type, for the short band at each end face to face. */
  compact?: boolean;
  /** Added to the test IDs, telling the two ends apart face to face. */
  suffix?: string;
  /** Face to face, the player at this end: their row says "you". */
  you?: Color | null;
}

/** Who won and how the score adds up, under the board so the final marks stay in view. */
export function ResultPanel({ title, subtitle, note, rows, onFixDead, still, compact, suffix = '', you }: Props) {
  const rise = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) return;
    Animated.spring(rise, { toValue: 1, friction: 8, tension: 70, useNativeDriver: true }).start();
  }, [rise, still]);

  return (
    <Animated.View
      testID={`result-card${suffix}`}
      style={[styles.panel, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}
    >
      <View style={styles.heading}>
        <Text
          style={[styles.title, compact && styles.titleCompact]}
          testID={`result-title${suffix}`}
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
        >
          {title}
        </Text>
        <Text style={[styles.subtitle, compact && styles.subtitleCompact]} testID={`result-subtitle${suffix}`}>
          {subtitle}
        </Text>
      </View>
      {/* One line in every language: a longer translation shrinks rather than pushing the board's buttons down. */}
      {note ? (
        <View style={styles.noteRow} accessible={!!note.spoken} accessibilityLabel={note.spoken}>
          <Text style={styles.note} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {note.text}
          </Text>
          {note.move && <Ionicons {...RANK_MOVE[note.move]} size={16} testID={`rank-${note.move}${suffix}`} />}
        </View>
      ) : null}
      {rows && <ScoreTable rows={rows} suffix={suffix} compact={compact} you={you} />}
      {onFixDead && (
        <Pressable onPress={onFixDead} testID="fix-dead-result" accessibilityRole="button" style={styles.link}>
          <Text style={styles.fixText}>{t('Wrong stones taken off? Fix them')}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

// Green up and red down as in any score; amber, the app's own colour, for a rank that held.
const RANK_MOVE: Record<RankMove, { name: 'caret-up' | 'caret-down' | 'remove'; color: string }> = {
  up: { name: 'caret-up', color: colors.rankUp },
  down: { name: 'caret-down', color: colors.danger },
  same: { name: 'remove', color: colors.accent },
};

const styles = StyleSheet.create({
  panel: { alignSelf: 'stretch', alignItems: 'center', gap: 2 },
  // The winner and the margin share a line when they fit, leaving room for both rows of the score.
  heading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline', columnGap: 10 },
  title: { fontFamily: fonts.heavy, fontSize: 20, color: colors.accent, textAlign: 'center' },
  titleCompact: { fontSize: 19 },
  subtitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  subtitleCompact: { fontSize: 13 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  note: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.accent, textAlign: 'center' },
  link: { alignItems: 'center', paddingVertical: 8 },
  fixText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMuted, textDecorationLine: 'underline' },
});
