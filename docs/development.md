# Development

Conventions the code doesn't show on its own. `AGENTS.md` has the short list; `docs/architecture.md` has the layers and the file map.

## The bot

- `Settings.bot` is a level from 1 to 7 (absent is 1). Each level has a rating per board size (`botRating` in `rating.ts`), and the setup starts at `levelFor` the player's rating.
- Levels 1 to 6 choose loosely among the network's moves, and levels 1 and 2 also slip to any of its likelier moves. The choice is seeded by the position (`LOOSENESS` in `katago.ts`), so a position always gets the same move, and tests rely on that. Changing `LOOSENESS` means measuring the ladder again (`modules/go-net/README.md`).
- On phones with 6 GB or more (`humanNetAvailable`) the setup offers a choice of network (`Settings.botNet`: `human`, the default there, or `kata`; absent is `kata`). Human-like levels take their moves from KataGo's human-style network at a rank profile (`humanStyleAt` in `human.ts`) and are rated by `botRating(level, size, net)`: levels 1 to 3 as the KataGo levels they were matched to, 4 to 7 by the rank they imitate. The small network still judges passing.
- Where the network can't run there is no bot. Screen tests mock `modules/go-net`.
- Dead-stone suggestions come from ownership: the network's against the bot, playouts' face to face and online. Playouts are weak while large areas are open, so players can always change the marks.

## Playouts on Hermes

Hermes has no JIT and runs the playouts about 10 times slower than Node. A full `Search` (`defaultPlayouts`: 1200, 500 and 200 for 9×9, 13×13 and 19×19) takes 3 to 4 s on the emulator, the yardstick of `timing.test.ts`. Playouts run in slices of about 30 ms (`runInSlices` in `src/ui/slices.ts`) so the UI stays smooth, and the hot loops in `FastBoard` use indexed typed arrays. The bot itself runs natively in `modules/go-net`.

## Sound, motion and labels

- Sound and haptics come from one decision, `cueFor` in `src/ui/cues.ts` (tested), played by `useGameCues`.
- `npm run sounds` generates `assets/sounds/` (`scripts/make-sounds.mjs`), and `npm run icons` draws the Shoutan, Shoutan Dev and Shoutan Local icons (`scripts/make-icons.mjs`). Change the scripts, not their output.
- Every animation respects reduce motion (`useReduceMotion`).
- Labels over the board follow `Callout` (`src/ui/board/Callout.tsx`): a note about a moment of play floats off and fades; a label for what the board shows now, such as a count step, stays until the next one.

## Wording and languages

- Copy is plain and beginner-friendly ("There’s already a stone there."). Wording lives in `src/ui/copy.ts`; sentences about the game on screen live in `src/screens/gameText.ts` and `onlineText.ts`.
- Name a player with one `Who` (`copy.ts`): `you`, `bot`, a colour, or `{ name }` for a family member.
- Every player-facing string goes through `t('English text', { params })` from `src/ui/i18n.ts`, or `phrase()` in a table, translated with `t` where it is shown. The same key goes in `src/ui/i18n/fi.ts`, `es.ts` and `it.ts`; `i18n.test.ts` fails on a missing or extra key or a lost `{placeholder}`.
- Keys are literal strings. A sentence that names a player gets one key per name ("Black’s turn to play", "You win!"), because the other languages inflect names.

## Licences

The cover's Licences page lists every work by others that the app ships, from `src/ui/notices.json`. Run `npm run notices` after changing dependencies, the networks or the native libraries. It reads the npm packages from the bundle; the Android libraries are listed by hand in `scripts/make-notices.mjs` (from `./gradlew :app:dependencies`). Add only what is compatible with AGPL-3.0. Real games for the tests (`src/go/__tests__/games/`) must be public domain or under an open licence, with the source and licence in `games/README.md`.

## Touch and styles on Android

Each of these was hit for real.

- **Touch position.** `locationX/Y` is relative to whichever view is under the finger, so `useBoardTouch` (`src/ui/board/`) converts `pageX/Y` using the board's measured position.
- **Hit-testing.** The board view is the only touch responder, and a tap places where the finger lifts. On the player's turn (`aimColor` set) a translucent stone and guide lines follow the finger. With a confirming tap (`aimAtOnce`) they show at once and lifting leaves a preview; otherwise they show only after the finger slides or rests, so a quick tap shows no flash. An idea tapped in the Guide's advice (`spotlight`) gets the guide lines and keeps its ghost stone, with its green ring turned solid. The per-point views are `pointerEvents="none"` and exist for screen readers (`activate` action) and UI tests (`testID="pt-D4"`, label "D4, black stone").
- **Double taps.** The control row changes with the game phase (Count becomes New game). `useTapGuard` in `src/screens/GameControls.tsx` ignores taps for 500 ms after a phase change; route every phase-dependent button through it.
- **Stale styles.** A native-driver transform or `borderStyle: 'dashed'` can stay on a view after the style is removed. Change the view's `key` or set the property explicitly.
- **Tap twice.** "Tap twice to place a stone" (`confirmMoves`, on by default) makes every move a preview tap and then a confirming tap (`needsConfirm` in `App.tsx`). Tests that place stones with one tap switch it off first: screen tests in `beforeEach`, Maestro flows through Settings from the main menu (`e2e/common/tap-twice.yaml`) before their first game.

## Checks

- `npx jest` takes about 20 s: the rules, and the screens through `src/__tests__/app.test.tsx`. Test screen behaviour (taps, menus, confirmations, what the board shows) there.
- `npm run verify` runs the database tests only when `supabase/`, `src/net/`, `src/online/` or the schema scripts changed since `main`; they need Docker and the local Supabase stack (`npm run setup` prepares a fresh clone). `Verify Shoutan` in CI runs everything (`verify:all`) on every push, and a failure shows on the commit.
- Device tests: `npm run build:local`, `adb install -r android/app/build/outputs/apk/release/app-release.apk`, then `npm run test:offline`, the smoke flow `e2e/smoke.yaml` in airplane mode (a few minutes). Check its screenshots under `e2e-output/` for clipping, overlap and unreadable text. `test:online` runs flows `06` to `09` against scripted API peers.
- Maestro waits for the screen to settle after each tap, so flows check end states, never a running animation. Flows run in English, the emulator's language. Maestro is pinned in `scripts/lib/maestro.mjs`; `npm run maestro:install` (part of `npm run setup`) puts it in `tools/maestro/`, and `MAESTRO_BIN` overrides the path.
- Device and build scripts print the outcome and write the rest to `e2e-output/*.log` or `dist/build-*.log`. Read the log when something failed; `VERBOSE=1` prints everything.
- `screenshots/` holds only the images in `README.md`, 540×1200. `e2e/readme-screenshots.yaml` takes all but the online one on a fresh install (`maestro test -e APP_ID=io.github.jphd3v.shoutan.local e2e/readme-screenshots.yaml`), and `scripts/readme-online.mjs` the online one; copy the results from the output's `takeScreenshot/` with `sips -Z 1200`. Retake them when the screens they show change.
- `Release Shoutan` runs `Device tests` in CI (`test:full`, then `test:online`) on the release commit and builds only if they pass, so a release needs no device run by hand. CI minutes are the free tier's 2,000 a month, which is why emulator runs stay out of every push.
