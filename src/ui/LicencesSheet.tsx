import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from './i18n';
import notices from './notices.json';
import { Sheet } from './Sheet';
import { colors, fonts } from './theme';

const texts: Record<string, string> = notices.texts;

/** Where the source code is published. */
export const SOURCE = 'https://github.com/jphd3v/shoutan';

/** Licence files are wrapped for a fixed-width terminal; on a phone each paragraph reads better as one flowing line. */
const unwrap = (text: string) => text.replace(/([^\n])\n[ \t]*(?=[^\n])/g, '$1 ');

/** The app's own licence and every work by others it ships, each opening to its licence text. */
export function LicencesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Sheet
      visible={visible}
      title={t('Licences')}
      onClose={() => {
        setOpen(null);
        onClose();
      }}
      testID="licences"
    >
      <Text style={styles.body}>
        {t('Shoutan is free software: you can share and change it under the GNU Affero General Public License, version 3.')}{' '}
        <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(SOURCE).catch(() => {})}>
          {SOURCE.replace('https://', '')}
        </Text>
      </Text>
      <Text style={styles.body}>
        {t('The cover picture was made by JPH with Google Gemini and ChatGPT. It is shared under the same licence.')}
      </Text>
      <Text style={styles.body}>{t('Shoutan is built on these works. Tap one to read its licence.')}</Text>
      {notices.works.map((work) => {
        const shown = open === work.name;
        return (
          <View key={work.name} style={styles.work}>
            <Pressable
              onPress={() => setOpen(shown ? null : work.name)}
              accessibilityRole="button"
              accessibilityState={{ expanded: shown }}
              style={styles.row}
            >
              <View style={styles.text}>
                <Text style={styles.name}>{'version' in work ? `${work.name} ${work.version}` : work.name}</Text>
                <Text style={styles.note}>{work.licence}</Text>
              </View>
              <Ionicons name={shown ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </Pressable>
            {shown && 'note' in work && <Text style={[styles.note, styles.opened]}>{work.note}</Text>}
            {shown && <Text style={styles.licence}>{unwrap(texts[work.text])}</Text>}
          </View>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.textMuted, marginBottom: 12 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  work: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  text: { flex: 1 },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.textMuted },
  opened: { marginBottom: 8 },
  licence: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, color: colors.textMuted, paddingBottom: 12 },
});
