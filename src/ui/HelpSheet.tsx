import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './Buttons';
import { goingFurther, howToPlay } from './copy';
import { t } from './i18n';
import { Sheet } from './Sheet';
import { Stone } from './Stone';
import { colors, fonts, radius } from './theme';

export function HelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [more, setMore] = useState(false);
  return (
    <Sheet visible={visible} title={t('Rules')} onClose={onClose} testID="help-sheet">
      {howToPlay.map((step, i) => (
        <Step key={step.title} title={`${i + 1}. ${t(step.title)}`} body={t(step.body)} diagram={step.diagram} icon="flag-outline" />
      ))}
      <Pressable
        onPress={() => setMore(!more)}
        testID="rules-more"
        accessibilityRole="button"
        accessibilityState={{ expanded: more }}
        style={styles.more}
      >
        <Text style={styles.moreText}>{t('Going further')}</Text>
        <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={20} color={colors.accent} />
      </Pressable>
      {more &&
        goingFurther.map((step) => (
          <Step key={step.title} title={t(step.title)} body={t(step.body)} diagram={step.diagram} icon="bulb-outline" />
        ))}
      <Button label={t('Got it')} testID="close-help" variant="primary" onPress={onClose} />
    </Sheet>
  );
}

function Step({
  title,
  body,
  diagram,
  icon,
}: {
  title: string;
  body: string;
  diagram: readonly string[] | null;
  icon: ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <View style={styles.step}>
      <View style={styles.figure}>{diagram ? <MiniBoard rows={diagram} /> : <Ionicons name={icon} size={34} color={colors.accent} />}</View>
      <View style={styles.text}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </View>
  );
}

/**
 * A tiny illustrative board. `X`/`O` are stones, `o` is a white stone about to
 * be captured, `b`/`w` mark empty points owned by Black/White, and `l` marks a liberty.
 */
function MiniBoard({ rows }: { rows: readonly string[] }) {
  const n = rows.length;
  const size = 88;
  const cell = size / n;
  return (
    <View style={[styles.mini, { width: size, height: size }]}>
      {rows.map((_, i) => (
        <View key={`l${i}`}>
          <View style={[styles.miniLine, { top: (i + 0.5) * cell, left: cell / 2, width: size - cell, height: 1 }]} />
          <View style={[styles.miniLine, { left: (i + 0.5) * cell, top: cell / 2, height: size - cell, width: 1 }]} />
        </View>
      ))}
      {rows.flatMap((row, r) =>
        row.split('').map((ch, c) =>
          ch === '.' ? null : (
            <View
              key={`${r}-${c}`}
              style={{
                position: 'absolute',
                left: c * cell,
                top: r * cell,
                width: cell,
                height: cell,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {ch === 'l' ? (
                <View style={[styles.liberty, { width: cell * 0.34, height: cell * 0.34, borderRadius: cell * 0.17 }]} />
              ) : ch === 'b' || ch === 'w' ? (
                <View
                  style={[styles.area, { width: cell * 0.36, height: cell * 0.36, backgroundColor: ch === 'b' ? '#151515' : '#F4F1EA' }]}
                />
              ) : (
                <Stone color={ch === 'X' ? 'black' : 'white'} size={cell * 0.9} faded={ch === 'o'} />
              )}
              {ch === 'o' && <Text style={[styles.cross, { fontSize: cell * 0.7 }]}>×</Text>}
            </View>
          ),
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: 16, marginBottom: 20, alignItems: 'center' },
  figure: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  stepTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text, marginBottom: 3 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  mini: { backgroundColor: colors.woodLight, borderRadius: radius.sm, overflow: 'hidden' },
  miniLine: { position: 'absolute', backgroundColor: colors.grid, opacity: 0.6 },
  cross: { position: 'absolute', color: colors.danger, fontWeight: '900' },
  liberty: { backgroundColor: colors.accent, borderWidth: 1, borderColor: '#1A1306' },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 12 },
  moreText: { fontFamily: fonts.bold, fontSize: 16, color: colors.accent },
  area: { borderRadius: 2, borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)' },
});
