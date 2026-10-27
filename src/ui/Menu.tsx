import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AboutLine } from './AboutLine';
import { t } from './i18n';
import { colors, fonts, radius } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** A large row that leads somewhere: the main menu's ways to play, the welcome's first choice, the game's ☰ menu. */
/** `chevron` (on by default) marks a row that leads to another page; a row that acts in place goes without. */
export function MenuRow(p: {
  icon: IconName;
  title: string;
  detail?: string;
  testID: string;
  onPress: () => void;
  primary?: boolean;
  chevron?: boolean;
}) {
  const ink = p.primary ? colors.accentInk : colors.text;
  return (
    <Pressable
      testID={p.testID}
      accessibilityRole="button"
      accessibilityLabel={p.detail ? `${p.title}, ${p.detail}` : p.title}
      onPress={p.onPress}
      style={({ pressed }) => [styles.row, p.primary && styles.rowPrimary, pressed && styles.pressed]}
    >
      <Ionicons name={p.icon} size={26} color={p.primary ? colors.accentInk : colors.accent} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: ink }]}>{p.title}</Text>
        {p.detail && (
          <Text style={[styles.rowDetail, p.primary && { color: colors.accentInk }]} numberOfLines={2}>
            {p.detail}
          </Text>
        )}
      </View>
      {p.chevron !== false && <Ionicons name="chevron-forward" size={20} color={p.primary ? colors.accentInk : colors.textMuted} />}
    </Pressable>
  );
}

export function TextLink({ label, icon, testID, onPress }: { label: string; icon: IconName; testID: string; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

/** The foot of both menus: Rules, Feedback and Settings, then the licence line when there is an `about` testID for it. */
export function MenuFooter(p: {
  onRules: () => void;
  onFeedback: () => void;
  onSettings: () => void;
  testIDs: { rules: string; feedback: string; settings: string; about?: string };
}) {
  return (
    <View style={styles.footer}>
      <View style={styles.links}>
        <TextLink label={t('Rules')} icon="help-circle-outline" testID={p.testIDs.rules} onPress={p.onRules} />
        <TextLink label={t('Feedback')} icon="chatbubble-ellipses-outline" testID={p.testIDs.feedback} onPress={p.onFeedback} />
        <TextLink label={t('Settings')} icon="options-outline" testID={p.testIDs.settings} onPress={p.onSettings} />
      </View>
      {p.testIDs.about && <AboutLine testID={p.testIDs.about} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowPrimary: { backgroundColor: colors.accent },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bold, fontSize: 18 },
  rowDetail: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMuted },
  footer: { marginTop: 'auto', gap: 14 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 20, rowGap: 8, marginTop: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 8 },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  pressed: { opacity: 0.7 },
});
