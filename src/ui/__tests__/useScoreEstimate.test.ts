import { act, renderHook } from '@testing-library/react-native';
import { GameState, newGame } from '../../go/rules';
import { playAll } from '../../go/__tests__/helpers';
import { useScoreEstimate } from '../useScoreEstimate';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const game = playAll(newGame(9), 'C3', 'G7', 'C7', 'G3');

type Props = { g: GameState; enabled?: boolean; key?: unknown; paused?: boolean };
const hook = (initialProps: Props) =>
  renderHook(({ g, enabled = true, key = 'game', paused }: Props) => useScoreEstimate(g, enabled, key, paused), { initialProps });

describe('useScoreEstimate', () => {
  it('works out an estimate for the position', async () => {
    const { result } = await hook({ g: game });
    expect(result.current).toBeNull();
    await act(() => jest.runAllTimers());
    expect(result.current?.owner).toHaveLength(81);
  });

  it('works out nothing while paused, keeping the last estimate, and catches up after', async () => {
    const { result, rerender } = await hook({ g: game });
    await act(() => jest.runAllTimers());
    const first = result.current;
    await rerender({ g: playAll(game, 'E5'), paused: true });
    await act(() => jest.runAllTimers());
    expect(result.current).toBe(first);
    await rerender({ g: playAll(game, 'E5'), paused: false });
    await act(() => jest.runAllTimers());
    expect(result.current).not.toBe(first);
  });

  it('keeps the last estimate shown until the next is ready', async () => {
    const { result, rerender } = await hook({ g: game });
    await act(() => jest.runAllTimers());
    const first = result.current;
    await rerender({ g: playAll(game, 'E5') });
    expect(result.current).toBe(first);
    await act(() => jest.runAllTimers());
    expect(result.current).not.toBe(first);
    expect(result.current).not.toBeNull();
  });

  it('keeps showing an estimate however many moves were played since, until another game is shown', async () => {
    const { result, rerender } = await hook({ g: game });
    await act(() => jest.runAllTimers());
    const first = result.current;
    await rerender({ g: playAll(game, 'E5', 'D4', 'F6', 'D6') });
    expect(result.current).toBe(first);
    await rerender({ g: playAll(game, 'E5', 'D4', 'F6', 'D6'), key: 'another game' });
    expect(result.current).toBeNull();
    await act(() => jest.runAllTimers());
    expect(result.current).not.toBeNull();
    await rerender({ g: newGame(9), key: 'game' });
    expect(result.current).toBeNull();
  });

  it('shows nothing when off or once play has ended', async () => {
    const { result, rerender } = await hook({ g: game, enabled: false });
    await act(() => jest.runAllTimers());
    expect(result.current).toBeNull();
    await rerender({ g: game });
    await act(() => jest.runAllTimers());
    expect(result.current).not.toBeNull();
    await rerender({ g: game, enabled: false });
    expect(result.current).toBeNull();
  });
});
