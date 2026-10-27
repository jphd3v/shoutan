import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { versionLabel } from '../config';
import { IconButton } from './Buttons';
import { LicencesSheet } from './LicencesSheet';
import { t } from './i18n';
import { BOARD_SHARE, WindowGame } from './WindowGame';
import { fonts } from './theme';
import splashPicture from '../../assets/splash.jpg';

// The picture's size and, in its own pixels, the blank panel the board is drawn into, the bare wall
// between the cats that holds the title, and the band from the panel's frame to the stone bowls that
// must stay on screen.
const PICTURE = { width: 941, height: 1672 };
const WINDOW = { x: 188, y: 243, width: 565, height: 522 };
const TITLE_Y = 1000;
const KEEP = { top: 205, bottom: 1545 };
// The picture's own edge colour, behind it where a wide screen leaves room at the sides.
const EDGE = '#BBA67C';

/**
 * Where the picture lands: filling the screen and cropped to fit, except that a screen wider than the
 * picture shows it smaller, with room at the sides, rather than cropping the panel or the cats.
 */
function placement(width: number, height: number) {
  const scale = Math.min(Math.max(width / PICTURE.width, height / PICTURE.height), height / (KEEP.bottom - KEEP.top));
  const shown = { width: PICTURE.width * scale, height: PICTURE.height * scale };
  const centred = height / 2 - ((KEEP.top + KEEP.bottom) / 2) * scale;
  const left = (width - shown.width) / 2;
  const top = Math.min(0, Math.max(height - shown.height, centred));
  return {
    picture: { left, top, ...shown },
    window: {
      left: left + WINDOW.x * scale,
      top: top + WINDOW.y * scale,
      width: WINDOW.width * scale,
      height: WINDOW.height * scale,
    },
    titleY: top + TITLE_Y * scale,
  };
}

/** The picture that opens the app and answers a tap on the copyright line, with the line itself along the bottom. */
export function Cover({ onClose, testID }: { onClose: () => void; testID: string }) {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const [licences, setLicences] = useState(false);
  // The screen's size places the board on the first frame, so the bare panel never shows; the measured size refines it.
  const size = measured ?? screen;
  const { picture, window: frame, titleY } = placement(size.width, size.height);
  // The bare wood the board leaves around it; the credit sits in the strip below, ending where the board does.
  const board = Math.min(frame.width, frame.height) * BOARD_SHARE;
  const margin = (frame.height - board) / 2;
  return (
    <Pressable
      style={styles.cover}
      onPress={onClose}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('Close')}
      onLayout={(e) => setMeasured(e.nativeEvent.layout)}
    >
      <Image source={splashPicture} style={[styles.image, picture]} accessible={false} />
      <View style={[styles.window, frame]} pointerEvents="none">
        <WindowGame width={frame.width} height={frame.height} />
        <Text style={[styles.credit, { height: margin, lineHeight: margin, paddingRight: (frame.width - board) / 2 }]}>
          {t('○ Lee Sedol vs ● AlphaGo, game 4')}
        </Text>
      </View>
      <View style={[styles.title, { top: titleY - TITLE_HEIGHT / 2 }]}>
        <Text style={styles.name} accessibilityRole="header">
          Shoutan
        </Text>
        <Text style={styles.hanzi}>手談</Text>
      </View>
      <View style={[styles.close, { top: insets.top + 12 }]}>
        <IconButton label={t('Close')} icon="close" testID={`${testID}-close`} size={44} onPress={onClose} />
      </View>
      {/* The line is small, so its touch area reaches well beyond it; a near miss shouldn't close the cover. */}
      <Pressable
        style={[styles.footer, { bottom: insets.bottom + 2 }]}
        hitSlop={{ top: 20, bottom: 20, left: 32, right: 32 }}
        accessibilityRole="link"
        accessibilityLabel={`© 2026 JPH · ${t('Version {v}', { v: versionLabel })} · AGPLv3 · ${t('Licences')}`}
        onPress={() => setLicences(true)}
      >
        <Text style={styles.footerText} testID={`${testID}-about`} numberOfLines={1}>
          {`© 2026 JPH · ${versionLabel} · AGPLv3`}
        </Text>
      </Pressable>
      <LicencesSheet visible={licences} onClose={() => setLicences(false)} />
    </Pressable>
  );
}

const TITLE_HEIGHT = 112;

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: EDGE },
  image: { position: 'absolute' },
  title: { position: 'absolute', alignSelf: 'center', alignItems: 'center', height: TITLE_HEIGHT },
  // Ink on the bare wall, in the painting's own dark brown.
  name: {
    fontFamily: fonts.title,
    fontSize: 60,
    lineHeight: 72,
    color: '#3A2616',
    textShadowColor: 'rgba(255, 246, 230, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  hanzi: { fontFamily: fonts.title, fontSize: 28, lineHeight: 40, color: '#3A2616', letterSpacing: 6 },
  window: { position: 'absolute', overflow: 'hidden' },
  credit: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    textAlign: 'right',
    fontFamily: fonts.regular,
    fontSize: 10,
    color: 'rgba(92, 58, 20, 0.85)',
  },
  close: { position: 'absolute', right: 14 },
  // Ink on the floor below the bowls, like the title.
  footer: { position: 'absolute', alignSelf: 'center' },
  footerText: {
    textAlign: 'center',
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#3A2616',
    textDecorationLine: 'underline',
  },
});
