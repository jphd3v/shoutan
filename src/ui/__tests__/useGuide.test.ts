import { renderHook } from '@testing-library/react-native';
import { GameState, newGame } from '../../go/rules';
import { playAll, position } from '../../go/__tests__/helpers';
import { useGuide } from '../useGuide';

const hook = (g: GameState) => renderHook(({ g }: { g: GameState }) => useGuide(g, true, false), { initialProps: { g } });

describe('useGuide', () => {
  it('notes a ko', async () => {
    const before = position(['.....', '.XO..', 'X.XO.', '.XO..', '.....'], 'white');
    const { result, rerender } = await hook(before);
    await rerender({ g: playAll(before, 'B3') });
    expect(result.current.note?.label).toBe('Ko! It can’t be taken back right away');
  });

  it('leaves playing into atari to the board', async () => {
    // Black's B1 leaves White's A1 with one liberty.
    const before = playAll(newGame(9), 'B1');
    const { result, rerender } = await hook(before);
    await rerender({ g: playAll(before, 'A1') });
    expect(result.current.note).toBeNull();
  });
});
