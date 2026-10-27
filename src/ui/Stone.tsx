import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { SLIDE_MS } from './stoneMotion';

interface Props {
  color: 'black' | 'white';
  size: number;
  /** Pops the stone in when it first appears, after this many milliseconds. */
  drop?: number;
  /**
   * Slides the stone in from (`dx`, `dy`) away when it first appears, after `delay` ms, the way a hand
   * puts it back (redo); with `away`, it lifts off and slides out there instead, the way a hand takes it back (undo).
   */
  slide?: Slide;
  faded?: boolean;
  /** Rings the stone as the last move; the ring is part of the stone, so it arrives and leaves with it. */
  marked?: boolean;
}

export interface Slide {
  delay: number;
  dx: number;
  dy: number;
  away?: boolean;
}

/** A shaded, slightly glossy stone with a soft drop shadow. */
export function Stone({ color, size, drop: dropProp, slide: slideProp, faded, marked }: Props) {
  // Read once: the motion belongs to the stone's first appearance, and later renders must not restart or stop it.
  const drop = useRef(dropProp).current;
  const slide = useRef(slideProp).current;
  // 1 is the stone resting on its point.
  const progress = useRef(new Animated.Value(drop !== undefined || (slide && !slide.away) ? 0 : 1)).current;

  useEffect(() => {
    const move =
      drop !== undefined
        ? Animated.sequence([
            Animated.delay(drop),
            Animated.spring(progress, { toValue: 1, friction: 6, tension: 160, useNativeDriver: true }),
          ])
        : slide
          ? Animated.sequence([
              Animated.delay(slide.delay),
              // Putting a stone back is taking it off played backwards.
              Animated.timing(progress, {
                toValue: slide.away ? 0 : 1,
                duration: SLIDE_MS,
                easing: slide.away ? Easing.in(Easing.quad) : Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
            ])
          : null;
    move?.start();
    return () => move?.stop();
  }, [drop, slide, progress]);

  const dx = slide?.dx ?? 0;
  const dy = slide?.dy ?? 0;
  const style = slide
    ? {
        opacity: progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] }),
        transform: [
          // The sideways part is the far end of the path, so the stone moves on a curve.
          { translateX: progress.interpolate({ inputRange: [0, 0.4, 0.75, 1], outputRange: [dx, dx * 0.3, dx * 0.04, 0] }) },
          { translateY: progress.interpolate({ inputRange: [0, 0.4, 0.75, 1], outputRange: [dy, dy * 0.55, dy * 0.12, 0] }) },
          // Small far off, a little big in the hand just over the board, and a quick press onto the point.
          { scale: progress.interpolate({ inputRange: [0, 0.35, 0.75, 0.9, 1], outputRange: [0.6, 1.08, 1.12, 0.96, 1] }) },
        ],
      }
    : {
        opacity: progress,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1.3, 1] }) }],
      };

  // The canvas is a little larger than the stone so the shadow is not clipped.
  const box = size * 1.16;
  const r = size / 2;
  const c = box / 2;
  const id = `g-${color}`;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: box,
        height: box,
        ...style,
        ...(faded && { opacity: 0.38 }),
      }}
    >
      <Svg width={box} height={box}>
        <Defs>
          {color === 'black' ? (
            <RadialGradient id={id} cx="34%" cy="28%" r="72%">
              <Stop offset="0" stopColor="#787878" />
              <Stop offset="0.28" stopColor="#303030" />
              <Stop offset="0.75" stopColor="#141414" />
              <Stop offset="1" stopColor="#080808" />
            </RadialGradient>
          ) : (
            <RadialGradient id={id} cx="34%" cy="28%" r="75%">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.55" stopColor="#EFEBE3" />
              <Stop offset="1" stopColor="#BDB4A6" />
            </RadialGradient>
          )}
          <RadialGradient id="shadow" cx="50%" cy="50%" r="50%">
            <Stop offset="0.6" stopColor="#000" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#000" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={c + size * 0.05} cy={c + size * 0.08} r={r * 1.06} fill="url(#shadow)" />
        <Circle
          cx={c}
          cy={c}
          r={r}
          fill={`url(#${id})`}
          stroke={color === 'black' ? 'rgba(255, 255, 255, 0.30)' : 'rgba(0, 0, 0, 0.16)'}
          strokeWidth={size >= 24 ? 1.2 : 0.8}
        />
        {color === 'black' && <Circle cx={c - r * 0.18} cy={c - r * 0.22} r={r * 0.32} fill="rgba(255, 255, 255, 0.09)" />}
        {marked && (
          <Circle
            cx={c}
            cy={c}
            r={size * 0.21}
            stroke={color === 'black' ? '#FFFFFF' : '#1A1A1A'}
            strokeWidth={Math.max(1.5, size * 0.0625)}
            fill="none"
          />
        )}
      </Svg>
    </Animated.View>
  );
}
