import { act, renderHook } from '@testing-library/react-native';
import { countPlan } from '../../go/count';
import { acceptScore, BLACK, GameState, newGame, pass, toggleDead, WHITE } from '../../go/rules';
import { playAll } from '../../go/__tests__/helpers';
import { useScoreCount } from '../ScoreCount';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const scoring = pass(pass(playAll(newGame(9), 'C3', 'G7', 'C7', 'G3')));
const over = acceptScore(scoring);
const final = countPlan(over);

type Props = { g: GameState; animate?: boolean; preview?: boolean; gameKey?: string };
const hook = (initialProps: Props, onEnd = jest.fn()) =>
  renderHook(
    ({ g, animate = true, preview = false, gameKey = 'game' }: Props) => useScoreCount({ game: g, animate, preview, onEnd, gameKey }),
    { initialProps },
  );

describe('useScoreCount', () => {
  it('the visible point squares match the running score, survive skipping and reopening, and undo with the count', async () => {
    const { result, rerender } = await hook({ g: scoring });
    await rerender({ g: over });
    expect(result.current.points).toEqual({ regions: [], shared: [] });
    await act(() => result.current.stepper!.next());
    const first = result.current.points;
    expect(first!.regions.flatMap((r) => r.points)).toHaveLength(2);
    await act(() => result.current.stepper!.back());
    expect(result.current.points).toEqual({ regions: [], shared: [] });
    while (result.current.stepper) {
      await act(() => result.current.stepper!.next());
      const marks = result.current.points!;
      for (const [color, owner] of [
        ['black', BLACK],
        ['white', WHITE],
      ] as const) {
        const squares = marks.regions.filter((r) => r.owner === owner).flatMap((r) => r.points).length;
        expect(squares + marks.shared.length / 2 + result.current.score!.breakdown[color].komi).toBe(result.current.score!.totals[color]);
      }
      if (result.current.current?.kind === 'shared') expect(result.current.current.color).toBeNull();
    }
    const wholeBoard = result.current.points;
    expect(new Set([...wholeBoard!.regions.flatMap((r) => r.points), ...wholeBoard!.shared]).size).toBe(81);
    await act(() => result.current.toLastStep!());
    expect(result.current.points).toEqual(wholeBoard);
    await act(() => result.current.stepper!.skip());
    expect(result.current.points).toEqual(wholeBoard);
    await rerender({ g: over, gameKey: 'reopened' });
    expect(result.current.points).toEqual(wholeBoard);
  });

  it('removed stones receive their captor’s point squares, never their own', async () => {
    const marked = pass(pass(playAll(newGame(9), 'E5', 'E4')));
    const black = marked.board.findIndex((s) => s === BLACK);
    const dead = acceptScore(toggleDead(marked, black));
    const { result } = await hook({ g: dead });
    expect(result.current.points!.regions.filter((r) => r.owner === BLACK).flatMap((r) => r.points)).not.toContain(black);
    expect(result.current.points!.regions.filter((r) => r.owner === WHITE).flatMap((r) => r.points)).toContain(black);
  });

  it('while marking with the preview on, the score shown is the count of the marked position, without steps', async () => {
    const { result } = await hook({ g: scoring, preview: true });
    expect(result.current.score?.totals).toEqual(countPlan(scoring).total);
    expect(result.current.score?.breakdown).toEqual(countPlan(scoring).breakdown);
    expect(result.current.stepper).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it('while marking without the preview, no score shows', async () => {
    const { result } = await hook({ g: scoring });
    expect(result.current.score).toBeNull();
  });

  it('counted on screen, the score starts at nothing and each step adds to it until the result', async () => {
    const onEnd = jest.fn();
    const { result, rerender } = await hook({ g: scoring }, onEnd);
    await rerender({ g: over });
    expect(result.current.onScreen).toBe(true);
    expect(result.current.score?.totals).toEqual({ black: 0, white: 0 });
    expect(result.current.status).toBe('Tap Watch, or ▶▶ to go step by step.');
    await act(() => result.current.stepper!.next());
    expect(result.current.score!.totals.black).toBeGreaterThan(0);
    expect(result.current.status).toMatch(/^Counting · step 1 of \d+$/);
    await act(() => result.current.stepper!.skip());
    expect(result.current.done).toBe(true);
    expect(result.current.stepper).toBeNull();
    expect(result.current.score).toEqual({ totals: final.total, breakdown: final.breakdown });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends on the areas step, which adds nothing but fills each player's area", async () => {
    const { result, rerender } = await hook({ g: scoring });
    await rerender({ g: over });
    expect(result.current.stepper!.total).toBe(final.steps.length + 1);
    await act(() => result.current.stepper!.skip());
    await act(() => result.current.toLastStep!());
    expect(result.current.areas).toBe(true);
    const totals = result.current.score!.totals;
    await act(() => result.current.stepper!.back());
    expect(result.current.areas).toBe(false);
    expect(result.current.score!.totals).toEqual(totals);
  });

  it('a game opened already over shows its whole score at once, and can step back from the last step', async () => {
    const { result } = await hook({ g: over });
    expect(result.current.onScreen).toBe(false);
    expect(result.current.done).toBe(true);
    expect(result.current.score).toEqual({ totals: final.total, breakdown: final.breakdown });
    await act(() => result.current.toLastStep!());
    expect(result.current.stepper).toMatchObject({ playing: false });
    expect(result.current.stepper!.index).toBe(result.current.stepper!.total);
  });
});
