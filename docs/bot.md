# The computer opponent

## Levels

The bot has seven levels, chosen with a slider in the setup. The slider starts at the level whose rating is nearest yours on that board size, so the bot gets stronger as you do. If you move the slider, the next game keeps the same distance from that level.

Every level reads a small KataGo network, `kata1-b10c128`, once per move, without searching ahead (`src/go/katago.ts`). Level 7 always plays the network's favourite move. Levels 3 to 6 choose among the moves the network likes, more loosely at each step down. The choice is seeded by the position, so a position always gets the same move, and it never takes a move the network barely considers. Levels 1 and 2 also slip: on about half of level 1's moves, and a quarter to two fifths of level 2's, they play any of the network's 10 to 40 likeliest moves, the way a beginner misses what matters.

In matches between neighbouring levels, each level beat the one below on every board size, mostly in 65 to 100% of the games. [modules/go-net/README.md](../modules/go-net/README.md) has the numbers and how the network was converted. On the emulator the network reads a 19×19 position in about 150 ms.

## Human-like play

On phones with 6 GB of memory or more, the setup offers Human-like (the default) or KataGo. Human-like plays with KataGo's human-style network, `b18c384nbt-humanv0` (`src/go/human.ts`). That network was trained on human games and predicts the move a player of a given rank would make.

Levels 1 to 3 imitate 25 to 22 kyu players. They were matched in desktop games to KataGo levels 1 to 3 and share their ratings. Levels 4 to 7 imitate 10 kyu, 5 kyu, 1 kyu and 5 dan, and are rated by that rank until they are measured. The human-style network adds 54 MB to the app and takes a few times longer per move.

## Passing, resigning and dead stones

The small network decides when to pass and resign, and which stones are dead, whichever network chooses the moves. After you pass, the bot passes back if it wins the count with the stones the network sees as dead taken off. It passes first only when nothing is left to play for. It resigns only late in a game it is losing by more than an eighth of the board.

Where the network can't run (on iOS, or in Expo Go), the menu offers no bot and says so.

## Playouts

Face to face and online there is no network in the game, so the dead-stone suggestion comes from Monte Carlo playouts (`src/go/ai.ts`): a few hundred quick random games played to the end, seeded so that every phone in an online game makes the same guess. They are accurate on finished positions and unreliable when large areas are still open, which is why you can always change the marks by hand. The same playouts decide whether a pass is early and give the score estimate.
