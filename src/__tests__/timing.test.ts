import { rng, Search } from '../go/ai';
import { passIsEarly } from '../go/guide';
import { GameState, newGame, pass, play } from '../go/rules';
import { guessDeadNow } from '../go/session';

/**
 * Work that runs on the phone's one JS thread, measured against a full search on the same machine
 * (`defaultPlayouts`, which takes 3–4 s on the emulator), so these ratios say what the player waits
 * for. Ratios, not milliseconds, so a slower machine doesn't fail them.
 */
function game(size: number, moves: number): GameState {
  let g = newGame(size);
  const random = rng(size);
  for (let i = 0; i < moves; i++) {
    let next = null;
    for (let tries = 0; tries < 20 && !next; tries++) {
      const r = play(g, Math.floor(random() * size * size));
      if (r.ok) next = r.state;
    }
    g = next ?? pass(g);
  }
  return g;
}

const fullSearch = (g: GameState) => {
  const s = new Search(g);
  s.run(s.total);
};

/** The fastest of a few runs, in ms: the least disturbed by anything else on the machine. */
function fastest(work: () => void, runs = 3): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    work();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('time on the JS thread, against a full search', () => {
  const ratios = (size: number, moves: number) => {
    const g = game(size, moves);
    const bot = fastest(() => fullSearch(g));
    return {
      guess: fastest(() => guessDeadNow(pass(pass(g)))) / bot,
      passCheck: fastest(() => passIsEarly(g)) / bot,
      search: fastest(() => new Search(g)) / bot,
    };
  };

  // Measured at about 0.25 / 0.9 (guess), 0.1 / 0.2 (pass check) and 0.01 (search setup) on 9×9 / 19×19.
  it.each([
    [9, 50],
    [19, 150],
  ])('%i×%i after %i moves: the dead-stone guess, the pass check and setting up a search stay within bounds', (size, moves) => {
    const r = ratios(size, moves);
    expect(r.guess).toBeLessThan(2);
    expect(r.passCheck).toBeLessThan(0.5);
    expect(r.search).toBeLessThan(0.1);
  });
});
