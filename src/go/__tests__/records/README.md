# Golden finished-game records

Finished games as the app writes them (`src/go/finished.ts`), one file per record. Every app
version must still read, replay and score each one; `finished.test.ts` checks that on the phone
and `supabase/tests/online.test.ts` checks the server accepts them (`broken()` in `index.ts` lists what both refuse). **Never edit or delete a file
here after a release wrote its format: add new files.** A new format, rules version or optional
field gets its own records.

| Folder   | What                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v1/`    | Format 1: even, handicap and one-stone games, scored, resigned and resumed, played signed in and signed out, a game played with the Coach (`coached`, no rating), one with a move taken back from the bot (`tookBack`, no rating), online games, and `with-unknown-fields`, carrying fields from a later app: the phone reads past them, the server refuses fields it has not learned |
| `newer/` | Records this app keeps and lists but asks for an update to see: format 2, and rules version 5                                                                                                                                                                                                                                                                                         |
| `phone/` | The phone's list of finished games (`go.finishedGames`) as it stores them                                                                                                                                                                                                                                                                                                             |

Two records replay real games from `../games/gnugo/area/` (GPL-3.0-or-later, see
`../games/README.md`): `online-19-scored` is KGS tournament 9, gopp against GNU Go;
`face-to-face-13-half-point` is KGS tournament 11, GNU Go against CrazyStone. Their dead stones are the app's guess, and their results match the records.
The other games were made up for these records.
