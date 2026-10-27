import { ReactNode, useEffect, useRef } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './Buttons';
import { t } from './i18n';
import { useReduceMotion } from './motion';
import { colors, fonts, radius } from './theme';

interface Props {
  visible: boolean;
  title?: string;
  onClose: () => void;
  /** A menu opened from a button at the top of the screen drops down from there instead of rising from the bottom. */
  from?: 'top' | 'bottom';
  children: ReactNode;
  testID?: string;
}

/** A sheet that slides in from the bottom (or the top) over a dimmed backdrop. */
export function Sheet({ visible, title, onClose, from = 'bottom', children, testID }: Props) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const reduceMotion = useReduceMotion();
  const top = from === 'top';

  useEffect(() => {
    if (!visible) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    if (reduceMotion) return slide.setValue(1);
    slide.setValue(0);
    Animated.spring(slide, { toValue: 1, friction: 9, tension: 70, useNativeDriver: true }).start();
  }, [visible, slide, reduceMotion]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('Close')} testID="sheet-backdrop" />
      <KeyboardAvoidingView behavior="padding" style={[styles.keyboard, top && styles.keyboardTop]} pointerEvents="box-none">
        <Animated.View
          testID={testID}
          style={[
            styles.sheet,
            top
              ? [
                  styles.sheetTop,
                  { paddingTop: insets.top + 14 },
                  // Grows out of the top-right corner, where the ☰ button is.
                  {
                    opacity: slide.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
                    transform: [
                      { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-120, 0] }) },
                      { scale: slide.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                    ],
                  },
                ]
              : [
                  styles.sheetBottom,
                  { paddingBottom: insets.bottom + 20 },
                  { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] },
                ],
          ]}
        >
          {!top && <View style={styles.handle} />}
          <View style={styles.headerRow}>
            {title ? <Text style={styles.title}>{title}</Text> : <View />}
            <IconButton label={t('Close')} icon="close" testID="sheet-close" size={38} onPress={onClose} />
          </View>
          <ScrollView
            key={visible ? 'open' : 'closed'}
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  keyboardTop: { justifyContent: 'flex-start' },
  sheet: {
    maxHeight: '82%',
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
    backgroundColor: 'rgba(28, 23, 18, 0.88)',
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: 'rgba(239, 168, 56, 0.25)',
    paddingHorizontal: 22,
  },
  sheetBottom: {
    borderTopWidth: 1.5,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 10,
  },
  // A menu over the game, as solid as the main menu it stands in for, so the board does not show through its rows.
  sheetTop: {
    maxHeight: '92%',
    backgroundColor: colors.background,
    paddingHorizontal: 20,
    borderBottomWidth: 1.5,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingBottom: 20,
    transformOrigin: 'top right',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(239, 168, 56, 0.4)', marginBottom: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontFamily: fonts.heavy, fontSize: 24, color: colors.text },
});
