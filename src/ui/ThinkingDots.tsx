import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReduceMotion } from './motion';
import { colors } from './theme';

/** Three softly pulsing dots shown while the computer is thinking; still ones with reduce motion. */
export function ThinkingDots() {
  const t = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 3, duration: 1200, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t, reduceMotion]);
  return (
    <View style={styles.row}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: reduceMotion
                ? 0.6
                : t.interpolate({
                    inputRange: [0, i, i + 0.5, i + 1, 3],
                    outputRange: [0.25, 0.25, 1, 0.25, 0.25],
                    extrapolate: 'clamp',
                  }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 5, marginLeft: 6, alignSelf: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
});
