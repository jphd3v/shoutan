import { ReactNode, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { useReduceMotion } from './motion';

const DIM_OPACITY = 0.3;
const FADE_MS = 150;

/**
 * Content that steps back while a confirmation beside it is open (`when`): faded, out of reach of
 * taps and screen readers, so only the confirmation's buttons are live. A tap on it calls `onTap`,
 * which cancels the confirmation.
 */
export function Dimmed({ when, onTap, testID, children }: { when: boolean; onTap: () => void; testID?: string; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(when ? DIM_OPACITY : 1)).current;
  useEffect(() => {
    const to = when ? DIM_OPACITY : 1;
    if (reduceMotion) opacity.setValue(to);
    else Animated.timing(opacity, { toValue: to, duration: FADE_MS, useNativeDriver: true }).start();
  }, [when, reduceMotion, opacity]);
  return (
    <Animated.View style={{ opacity }} importantForAccessibility={when ? 'no-hide-descendants' : 'auto'}>
      <Animated.View pointerEvents={when ? 'none' : 'auto'}>{children}</Animated.View>
      {when && <Pressable style={StyleSheet.absoluteFill} onPress={onTap} testID={testID} accessible={false} />}
    </Animated.View>
  );
}
