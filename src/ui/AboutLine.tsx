import { useState } from 'react';
import { Modal, StyleSheet, Text } from 'react-native';
import { versionLabel } from '../config';
import { Cover } from './Cover';
import { t } from './i18n';
import { colors, fonts } from './theme';

/** Copyright, licence and version in one small line that opens the cover picture, which links to the source code. */
export function AboutLine({ testID }: { testID: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Text
        style={styles.line}
        testID={testID}
        accessibilityRole="link"
        accessibilityLabel={`© 2026 JPH · AGPLv3 · ${t('Version {v}', { v: versionLabel })}`}
        onPress={() => setOpen(true)}
      >
        {`© 2026 JPH · AGPLv3 · ${versionLabel}`}
      </Text>
      <Modal visible={open} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
        <Cover testID={`${testID}-cover`} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  line: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: 8,
  },
});
