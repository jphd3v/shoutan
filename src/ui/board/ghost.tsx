import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import type { Color } from '../../go/rules';
import { Stone } from '../Stone';
import { colors, fonts } from '../theme';

/**
 * How a ghost stone (a suggested move) looks, on the board and beside it: a see-through stone of the
 * player to move, ringed with green dashes.
 */
export const GHOST = {
  opacity: { black: 0.42, white: 0.65 },
  number: { black: '#FFFFFF', white: '#14100A' },
} as const;

/**
 * A small ghost stone for the Guide's advice, so a sentence points at the stone on the board that looks the
 * same; with `number` when there are several. `shown`: the idea is spotlighted on the board.
 */
export function GhostStone({ color, size, number, shown }: { color: Color; size: number; number?: number; shown?: boolean }) {
  const stroke = 1.5;
  return (
    <View style={{ width: size, height: size }}>
      <View style={[StyleSheet.absoluteFill, styles.centre, { opacity: GHOST.opacity[color] }]}>
        <Stone color={color} size={size * 0.92} />
      </View>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          // Keyed by the look, so a ring that turns solid remounts instead of keeping its dashes.
          key={shown ? 'solid' : 'dashed'}
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - stroke / 2}
          stroke={colors.idea}
          strokeWidth={stroke}
          strokeDasharray={shown ? undefined : '2.5 2'}
          fill="none"
        />
        {number !== undefined && (
          <SvgText
            x={size / 2}
            y={size / 2 + size * 0.16}
            textAnchor="middle"
            fontSize={size * 0.46}
            fontFamily={fonts.heavy}
            fill={GHOST.number[color]}
          >
            {number}
          </SvgText>
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
