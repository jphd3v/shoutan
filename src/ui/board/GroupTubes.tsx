import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, G, LinearGradient, Rect, Stop } from 'react-native-svg';
import { connections } from '../../go/guide';
import type { GameState } from '../../go/rules';

const SHADE = {
  black: ['#262626', '#4A4A4A', '#1C1C1C', '#080808'],
  white: ['#DDD6CB', '#FFFFFF', '#E9E4DB', '#B3A998'],
};
const OFFSETS = ['0', '0.3', '0.65', '1'];

/**
 * With Groups, each stone is joined to its same-coloured neighbours by a short round tube under the
 * stones, shaded across its width like the stones are (light from the top left). Its ends hide under the stones.
 * Memoised: the board re-renders on every finger move while aiming.
 */
export const GroupTubes = memo(function GroupTubes({
  board,
  n,
  origin,
  cell,
  width,
  height,
}: {
  board: GameState['board'];
  n: number;
  origin: number;
  cell: number;
  width: number;
  height: number;
}) {
  const links = connections(board, n);
  const where = (i: number) => origin + i * cell;
  const bar = cell * 0.2;
  return (
    <Svg width={width} height={height} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        {(['black', 'white'] as const).flatMap((color) =>
          (['across', 'down'] as const).map((way) => (
            // A tube across the board is lit along its top edge, one down the board along its left.
            <LinearGradient
              key={`${way}-${color}`}
              id={`tube-${way}-${color}`}
              x1="0"
              y1="0"
              x2={way === 'down' ? '1' : '0'}
              y2={way === 'across' ? '1' : '0'}
            >
              {SHADE[color].map((c, k) => (
                <Stop key={k} offset={OFFSETS[k]} stopColor={c} />
              ))}
            </LinearGradient>
          )),
        )}
      </Defs>
      {(['black', 'white'] as const).map((color) => {
        const mine = links.filter((l) => l.color === color);
        return mine.length ? (
          <G key={color} testID={`groups-${color}`}>
            {mine.map(({ from, to }) => {
              const across = to === from + 1;
              const x = where(from % n);
              const y = where(Math.floor(from / n));
              return (
                <Rect
                  key={`${from}-${to}`}
                  x={across ? x : x - bar / 2}
                  y={across ? y - bar / 2 : y}
                  width={across ? cell : bar}
                  height={across ? bar : cell}
                  fill={`url(#tube-${across ? 'across' : 'down'}-${color})`}
                />
              );
            })}
          </G>
        ) : null;
      })}
    </Svg>
  );
});
