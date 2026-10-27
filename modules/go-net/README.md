# go-net

The bot's network, run on the phone. A local Expo module (autolinked from `modules/`), Android only.

- `index.ts`: `evaluateNet(name, size, inputs, meta?)`, `netAvailable` and `humanNetAvailable`. Where the module isn't built in (iOS, Jest, Expo Go) `netAvailable` is false and the menu offers no bot.
- `android/…/GoNetModule.kt`: runs the ONNX file with ONNX Runtime (`com.microsoft.onnxruntime:onnxruntime-android`, pinned in `android/build.gradle`) off the JS thread. It only evaluates: the inputs are encoded and the move chosen in `src/go/katago.ts`.
- `android/src/main/assets/nets/kata1-b10c128.onnx`: the network, 12 MB, with its licence beside it (`LICENSE.txt`, the MIT-style KataGo Neural Network License).
- `android/src/main/assets/nets/b18c384nbt-humanv0.onnx`: the human-style network, 54 MB (see Human-style levels).

On the Medium Phone emulator one evaluation takes about 150 ms on 19×19. The runtime adds about 26 MB to the APK (arm64 only) and the network 12 MB.

## Making the ONNX file again

```sh
curl -O https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b10c128-s1141046784-d204142634.txt.gz
python3 -m venv .venv && .venv/bin/pip install numpy onnx
.venv/bin/python scripts/convert-net.py kata1-b10c128-s1141046784-d204142634.txt.gz modules/go-net/android/src/main/assets/nets/kata1-b10c128.onnx
```

The output is the same byte for byte. The converter reads KataGo's text format (model version 8) and writes one graph that serves 9×9, 13×13 and 19×19.

## Choosing the network

A spike (issue #28) played the networks' first instinct, with no search, against the Beginner bot: b6c96 and b10c128 each won 10 of 10 on every board size, and b10c128 beat b6c96 17 of 20 on 9×9 and 20 of 20 on 19×19. On a desktop one b10c128 evaluation takes 8 / 13 / 28 ms on 9 / 13 / 19. Rather than a second network, the levels below the strongest play the same network more loosely (see Levels).

## Levels

Level 7 plays the network's favourite move; levels 1–6 choose among its moves with the policy flattened by a temperature (`heat`), never taking a move it likes less than `floor` times its favourite (`LOOSENESS` in `src/go/katago.ts`). Levels 1 and 2 also `slip`: on that share of moves they play any of the network's `wide` likeliest legal moves (never filling their own eye), so they miss what matters as a beginner does. Until October 2026 level 1 was a Monte Carlo bot; levels 3–7 are the earlier network levels 2, 3, 4, 5 and 7.

The ladder was measured on a desktop with onnxruntime-node: each level against the one below, the games alternating colours, the first two moves at random points away from the edge so games differ, finished positions scored with `kata1-b15c192`'s ownership as the judge. Wins for the stronger level:

| Level vs the one below | 2 v 1 | 3 v 2 | 4 v 3 | 7 v 6 |
| ---------------------- | ----- | ----- | ----- | ----- |
| 9×9 (30 games)         | 29    | 23    | 22    | 26    |
| 13×13 (20 games)       | 17    | 13    | –     | 19    |
| 19×19 (12 games)       | 12    | 9     | –     | 12    |

Levels 4–6 are the earlier levels 3–5, whose steps won 26–31 of 30 games with fixed openings (5 v 4 on 13×13 with varied openings: 19 of 20). The slips were tuned against the earlier level 2 (now 3): on 19×19 it beat the 40%-slip setting 10 of 12 and the 60%-slip one every game; on 9×9 the 50%-slip setting also lost 19 of 20 to the old Monte Carlo bot. 9×9 has its own, gentler steps, since a few loose moves decide a short game.

The ratings in `src/go/rating.ts` keep level 7's estimate and space the levels below by these results (the log-odds of each result, capped where a level won every game).

## Human-style levels

KataGo's human-style network (`b18c384nbt-humanv0`, KataGo release v1.15.0) was trained on human games and takes a profile (`input_meta`, 192 numbers): it predicts the move a player of that rank would make. `humanMeta` in `src/go/human.ts` ports KataGo's `rank_<rank>` profile (KGS, both players that rank). On phones reporting at least 5 GB of memory (`humanNetAvailable`; phones sold as 6 GB report about 5.5) setup lets the player choose it for every level (`Settings.botNet`, Human-like by default). Its levels sample its moves (`HUMAN_STYLES`), as KataGo's own human play does, while the small network still judges passing, resigning and dead stones (`withHumanMoves`). Levels 4–7 imitate 10 kyu, 5 kyu, 1 kyu and 5 dan (inverse 19, 14, 10, 5) and are rated by that rank (`botRating` in `src/go/rating.ts`), not yet measured.

Inverse rank 34 is about 25 kyu, the weakest profile it was trained on; 31 is 22 kyu, 29 is 20 kyu. Levels 1–3 were matched on a desktop against the small network's level of the same number (wins for the human style; heat 1 samples its prediction as it is):

| Board | Style vs level   | Wins     |
| ----- | ---------------- | -------- |
| 9×9   | 25k heat 1.5 v 1 | 8 of 20  |
| 9×9   | 25k v 2          | 9 of 20  |
| 9×9   | 20k v 3          | 9 of 20  |
| 13×13 | 25k v 1          | 13 of 16 |
| 13×13 | 25k v 2          | 11 of 16 |
| 13×13 | 20k v 3          | 14 of 16 |
| 19×19 | 25k v 1          | 4 of 10  |
| 19×19 | 22k v 2          | 4 of 10  |
| 19×19 | 22k v 3          | 8 of 10  |

On 13×13 the human style played stronger, so its levels there are softened with heat (1.7 / 1.3 / 1 at 25k); 19×19 uses 25k heat 1.3 / 25k / 22k. These are small samples: treat the human levels' ratings as rough.

The file is the training checkpoint exported with the weights stored as fp16 (outputs match fp32): 54 MB. On a desktop one evaluation takes 51 ms on 9×9 and 169 ms on 19×19. To make it again, download `b18c384nbt-humanv0.ckpt` from KataGo's v1.15.0 release, run `python/migrate_defaultdict_to_dict.py` from a KataGo checkout on it, then, in a venv with torch, onnx and numpy:

```sh
python3 scripts/export-human-net.py <KataGo checkout> b18c384nbt-humanv0.ckpt modules/go-net/android/src/main/assets/nets/b18c384nbt-humanv0.onnx
```

## Inputs and passing

`encode` follows KataGo's v7 inputs for area scoring. Planes 18 and 19 hold the area each side would score if play stopped now (`area`, a port of KataGo's `calculateArea`: pass-alive groups by Benson's test, and empty areas only one colour borders). With these planes empty the network saw a board worth only komi and liked to pass halfway through a 19×19 game.

Even with them the network alone passes too soon when far ahead, and keeps capturing dead stones after the opponent passes: KataGo relies on search, and it was trained to play dead stones out. This app removes dead stones by agreement, so `decide` passes by its own rules:

- After the opponent passes, it passes back whenever it wins the app's count with the stones the network thinks dead removed (`marginNow`).
- It passes first only when the network prefers passing and nothing is left to play for: every point the count leaves neutral is one the network gives to neither side (`settled`). Otherwise it plays on, never filling its own eye.

Against the bot the dead-stone guess after both pass comes from the network's ownership too (`deadFromNet`), with the thresholds of the playout guess.
