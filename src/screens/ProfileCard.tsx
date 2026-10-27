import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../ui/theme';

/** The top of a player's card: their picture large, their name, and a line under it, with a presence dot when it says who is online. */
export function ProfileHeader(p: { avatar: string | null; name: string; subtitle: string; online?: boolean }) {
  return (
    <View style={styles.header}>
      <View style={styles.ring}>
        <View style={styles.disc}>
          <Text style={styles.avatar} importantForAccessibility="no">
            {p.avatar}
          </Text>
        </View>
      </View>
      <View style={styles.headerText}>
        <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
          {p.name}
        </Text>
        <View style={styles.subtitleRow}>
          {p.online !== undefined && <View style={[styles.dot, p.online && styles.dotOnline]} />}
          <Text style={styles.subtitle}>{p.subtitle}</Text>
        </View>
      </View>
    </View>
  );
}

/** A few numbers side by side, each large over its label. */
export function StatTiles(p: { tiles: { value: string; label: string }[] }) {
  return (
    <View style={styles.tiles}>
      {p.tiles.map((tile) => (
        <View key={tile.label} style={styles.tile} accessible accessibilityLabel={`${tile.label}: ${tile.value}`}>
          <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
            {tile.value}
          </Text>
          <Text style={styles.tileLabel} numberOfLines={1}>
            {tile.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A labelled fact on its own line. */
export function Fact(p: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{p.label}</Text>
      <Text style={styles.factValue}>{p.value}</Text>
    </View>
  );
}

/** A section folded away behind its title, for details only the curious open. */
export function Folded(p: { title: string; testID: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.folded}>
      <Pressable
        onPress={() => setOpen(!open)}
        style={styles.foldedTitleRow}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={p.testID}
      >
        <Text style={styles.foldedTitle}>{p.title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>
      {open && p.children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  ring: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { fontSize: 38, lineHeight: 46 },
  headerText: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.heavy, fontSize: 26, color: colors.text },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subtitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.textMuted },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border },
  dotOnline: { backgroundColor: colors.online },
  tiles: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  tileValue: { fontFamily: fonts.heavy, fontSize: 22, color: colors.accent },
  tileLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  fact: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  factLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted },
  factValue: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.text },
  folded: { marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  foldedTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  foldedTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
});
