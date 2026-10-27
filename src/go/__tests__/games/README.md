# Game records used by `games.test.ts`

All files are SGF, unchanged from their source. None of them ship in the app.

| Folder           | What                                                                                                                                                                                                      | Source                                                                                        | Licence                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| `classics/`      | Three of Honinbo Shusaku's games: against Honinbo Shuwa in 1846, against Inoue Gennan Inseki in 1846, and against Ota Yuzo in 1853                                                                        | [Slymaster/masame](https://github.com/Slymaster/masame), `public/assets/classics/`            | MIT, see `classics/LICENSE`           |
| `gnugo/cgos/`    | 9×9 games from the Computer Go Server under Tromp-Taylor rules: four played out to the end and four that ended on a move illegal under the Chinese rules too, named in the last comment                   | [GNU Go 3.8](https://ftp.gnu.org/gnu/gnugo/gnugo-3.8.tar.gz), `regression/games/cgos/`        | GPL-3.0-or-later, see `gnugo/COPYING` |
| `gnugo/area/`    | 58 computer tournament games (KGS, Computer Olympiads 2003–2006) under Chinese rules, ended by two passes with dead stones still on the board. File names are the original paths with `/` replaced by `-` | GNU Go 3.8, `regression/games/`                                                               | GPL-3.0-or-later                      |
| `gnugo/superko/` | Two games that repeat an earlier whole-board position, which their simple-ko rules allowed                                                                                                                | GNU Go 3.8, `regression/games/filllib10.sgf` and `regression/games/gifu2006/gnugo-gorimu.sgf` | GPL-3.0-or-later                      |

GPL-3.0 files may be combined with AGPL-3.0 code (section 13 of each licence).

The `area/` set holds only the area-scored games where our dead-stone guess and count give the
recorded result; GNU Go's collection has 11 more. Those ended in unsettled positions or carry
results we couldn't reproduce by hand (one 9×9 game is recorded as B+74.5), except
`olympiad2004/9x9/gnu-int-playoff.sgf`, where our guess misses a lone dead White stone inside a
large Black area.
