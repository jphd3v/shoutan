import { render, screen } from '@testing-library/react-native';
import Svg from 'react-native-svg';
import { LibertyRings } from '../board/LibertyRings';

it.each([9, 13, 19])('on %s-line boards, shared liberties keep both halves and each last-liberty warning', async (n) => {
  const cell = 360 / (n + 1);
  await render(
    <Svg>
      <LibertyRings
        n={n}
        cell={cell}
        origin={cell}
        liberties={[
          { point: 0, black: true, white: false, last: { black: false, white: false } },
          { point: 1, black: false, white: true, last: { black: false, white: true } },
          { point: 2, black: true, white: true, last: { black: true, white: false } },
          { point: 3, black: true, white: true, last: { black: true, white: true } },
        ]}
      />
    </Svg>,
  );
  expect(screen.getByTestId('liberty-0-black').props.r).toBeCloseTo(cell * 0.1275);
  expect(screen.queryByTestId('liberty-0-black-last')).toBeNull();
  expect(screen.getByTestId('liberty-1-white-last')).toBeTruthy();
  expect(screen.getByTestId('liberty-2-black').props.d).not.toBe(screen.getByTestId('liberty-2-white').props.d);
  expect(screen.getByTestId('liberty-2-black-last')).toBeTruthy();
  expect(screen.queryByTestId('liberty-2-white-last')).toBeNull();
  expect(screen.getByTestId('liberty-3-black-last')).toBeTruthy();
  expect(screen.getByTestId('liberty-3-white-last')).toBeTruthy();
});
