import { Circle, G, Path } from 'react-native-svg';
import type { Liberty } from '../../go/guide';
import { colors } from '../theme';

/** A shared liberty keeps each colour's half, including its own last-liberty warning. */
export function LibertyRings({ liberties, n, cell, origin }: { liberties: readonly Liberty[]; n: number; cell: number; origin: number }) {
  const r = cell * 0.1275;
  const width = Math.max(1.1, cell * 0.0413);
  return liberties.map((l) => {
    const x = origin + (l.point % n) * cell;
    const y = origin + Math.floor(l.point / n) * cell;
    const shared = l.black && l.white;
    const arc = (radius: number, left: boolean) => `M${x} ${y - radius}a${radius} ${radius} 0 0 ${left ? 0 : 1} 0 ${2 * radius}`;
    return (
      <G key={l.point}>
        <Circle cx={x} cy={y} r={r} fill="none" stroke="#514532" strokeWidth={width + 1.05} />
        {(['black', 'white'] as const).map((color) => {
          if (!l[color]) return null;
          const stroke = color === 'black' ? '#141414' : '#FFFFFF';
          const testID = `liberty-${l.point}-${color}`;
          return (
            <G key={color}>
              {shared ? (
                <Path testID={testID} d={arc(r, color === 'black')} fill="none" stroke={stroke} strokeWidth={width} />
              ) : (
                <Circle testID={testID} cx={x} cy={y} r={r} fill="none" stroke={stroke} strokeWidth={width} />
              )}
              {l.last[color] &&
                (shared ? (
                  <Path
                    testID={`${testID}-last`}
                    d={arc(r + width + 0.75, color === 'black')}
                    fill="none"
                    stroke={colors.danger}
                    strokeWidth={width}
                  />
                ) : (
                  <Circle
                    testID={`${testID}-last`}
                    cx={x}
                    cy={y}
                    r={r + width + 0.75}
                    fill="none"
                    stroke={colors.danger}
                    strokeWidth={width}
                  />
                ))}
            </G>
          );
        })}
      </G>
    );
  });
}
