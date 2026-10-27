import { memo, useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, RadialGradient, Stop } from 'react-native-svg';
import { type Owner, type Patch, paint, SIZE, stones } from './coverGame';
import { useReduceMotion } from './motion';
import { colors } from './theme';

/** The board shows alone for a moment, then its areas are painted in over the stones. */
const HOLD_MS = 1500;
const PAINT_MS = 4500;
const FADE_MS = 1200;
/**
 * The painting comes in as a few layers, each drawn once and faded in by the native driver, so no
 * frame of it redraws the board: weaker devices can't redraw hundreds of gradient stones ten times a second.
 */
const WAVES = 10;
/** How much of the window's shorter side the board takes, leaving bare wood around it. */
export const BOARD_SHARE = 0.86;

const occupied = new Set(stones.map((s) => `${s.x},${s.y}`));
const waves: Patch[][] = Array.from({ length: WAVES }, () => []);
for (const p of paint()) {
  if (!occupied.has(`${p.x},${p.y}`)) waves[Math.min(WAVES - 1, Math.floor(p.start * WAVES))].push(p);
}

/** The game inside the cover's window: Lee Sedol against AlphaGo, turning slowly into black and white areas. */
export function WindowGame({ width, height }: { width: number; height: number }) {
  const reduceMotion = useReduceMotion();
  const fades = useRef(waves.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (reduceMotion) {
      fades.forEach((f) => f.setValue(1));
      return;
    }
    const run = Animated.parallel(
      fades.map((f, i) =>
        Animated.timing(f, { toValue: 1, duration: FADE_MS, delay: HOLD_MS + (i / WAVES) * PAINT_MS, useNativeDriver: true }),
      ),
    );
    run.start();
    return () => run.stop();
  }, [reduceMotion, fades]);

  const side = Math.min(width, height) * BOARD_SHARE;
  const g = side / SIZE;
  const box = { left: (width - side) / 2, top: (height - side) / 2, width: side, height: side };

  return (
    <>
      <View style={styles.wood} />
      <View style={[styles.layer, box]} pointerEvents="none">
        <Board g={g} />
      </View>
      {waves.map((wave, i) => (
        <Animated.View key={i} style={[styles.layer, box, { opacity: fades[i] }]} pointerEvents="none">
          <Wave patches={wave} g={g} />
        </Animated.View>
      ))}
    </>
  );
}

function Gradients() {
  return (
    <Defs>
      <RadialGradient id="cover-black" cx="35%" cy="30%" r="75%">
        <Stop offset="0" stopColor="#5A5651" />
        <Stop offset="0.6" stopColor="#1B1917" />
        <Stop offset="1" stopColor="#0B0A09" />
      </RadialGradient>
      <RadialGradient id="cover-white" cx="35%" cy="30%" r="75%">
        <Stop offset="0" stopColor="#FFFFFF" />
        <Stop offset="0.7" stopColor="#ECE7DE" />
        <Stop offset="1" stopColor="#CFC8BC" />
      </RadialGradient>
    </Defs>
  );
}

function StoneAt({ x, y, g, color, opacity = 1 }: { x: number; y: number; g: number; color: Owner; opacity?: number }) {
  return (
    <>
      <Circle cx={(x + 0.5) * g + g * 0.05} cy={(y + 0.5) * g + g * 0.07} r={g * 0.46} fill="#000" fillOpacity={0.3 * opacity} />
      <Circle cx={(x + 0.5) * g} cy={(y + 0.5) * g} r={g * 0.46} fill={`url(#cover-${color})`} fillOpacity={opacity} />
    </>
  );
}

const Board = memo(function Board({ g }: { g: number }) {
  const lines = Array.from({ length: SIZE }, (_, i) => (i + 0.5) * g);
  const far = SIZE * g - g / 2;
  return (
    <Svg width={SIZE * g} height={SIZE * g}>
      <Gradients />
      <G stroke={colors.grid} strokeOpacity={0.6} strokeWidth={Math.max(0.6, g / 26)}>
        {lines.map((p) => (
          <G key={p}>
            <Line x1={g / 2} y1={p} x2={far} y2={p} />
            <Line x1={p} y1={g / 2} x2={p} y2={far} />
          </G>
        ))}
      </G>
      {stones.map((s) => (
        <StoneAt key={`${s.x},${s.y}`} x={s.x} y={s.y} g={g} color={s.color} />
      ))}
    </Svg>
  );
});

/** One layer of painted points, at their full strength; the layer's own opacity fades it in. */
const Wave = memo(function Wave({ patches, g }: { patches: Patch[]; g: number }) {
  return (
    <Svg width={SIZE * g} height={SIZE * g}>
      <Gradients />
      {patches.map((p) => (
        <StoneAt key={`${p.x},${p.y}`} x={p.x} y={p.y} g={g} color={p.owner} opacity={0.8 + 0.2 * p.strength} />
      ))}
    </Svg>
  );
});

const styles = StyleSheet.create({
  wood: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.woodLight },
  layer: { position: 'absolute' },
});
