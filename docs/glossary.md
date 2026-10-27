# Glossary

Names the code and its documents use for the app's own concepts. Go terms (liberty, atari, ko, komi, seki) mean what they mean in the game; the rules sheet explains them to players.

**Game on this phone**: the game kept in the `Session` and changed only by its reducer: against the bot or face to face. _Avoid_: offline game, local game.

**Online game**: a game between two family phones, kept as a hash-chained event log on the server and replayed on each phone.

**Presence**: a family member having Play online or an online game open. The phone tells the server every 20 s (`touch_presence`); a member counts as online for 45 s after, then shows as seen some time ago. _Avoid_: status, activity.

**Ask to play**: an online game addressed to one family member (`games.invited`); only they can join it, and the others do not list it.

**Shown game**: whichever game is on screen, the game on this phone, the online game the player opened, or a finished game opened for review from the profile's list, as the screen asks about it (`src/screens/shownGame.ts`). The three kinds are its adapters.

**Viewer**: the player holding the phone: the human against the bot, or the player in their seat online. Face to face there is none.

**Face to face**: two players at one phone, sitting across it from each other; each end of the screen speaks to its own player. _Avoid_: hot seat, local multiplayer.

**Who**: how a sentence names a player: `you`, `bot`, a colour face to face, or a family member's name online. Every sentence that names a player has one key per kind, because the app's other languages inflect names.

**Count**: after both players accept, the score shown step by step on the board: dead stones off, each player's stones, territory, komi, then each player's whole area. With step-by-step counting off, the score shows while the dead stones are marked instead.

**Marking**: after two passes, the players agree on dead stones before the count; the app suggests them, and players toggle them.

**Coach**: the bot's network advising the player on their turn: its strongest moves as ghost stones, outlined groups and the last move's cost, with notes on ko and on playing into atari. Its own switch, last under Hints in Settings. _Avoid_ calling the Coach itself a hint: Hints names the whole section.

**Hints**: the Coach and the lighter helps shown while playing, from the rules and playouts: Liberties, Groups, Territory, Likely areas, Score estimate, all under Hints in Settings. In code the lighter helps are the Guide (`useGuide.ts`). _Avoid_ in player-facing text: Guide, which is too close to the Coach.

**Finished-game record**: a finished game as the phone keeps it and the server stores it (`src/go/finished.ts`): its `format`, the **core** (what replays and scores it: rules version, board, komi, setup, moves, dead stones, result) and **meta** (mode, the viewer's colour, handicap, and the rating it moved, or `coached` when the Coach was on, or `tookBack` when a move was taken back from the bot). A record from a newer app is kept as it is and shown as needing an update. _Avoid_: saved game (that is the unfinished game on this phone).

**Account**: a player's email login on this phone, signed in with a code mailed to them. Optional: offline play works without one; online play and feedback ask to sign in. The phone has one profile and one set of games whether signed in or not; signing in links them to the account, and when the account is in the family its name and animal win, and its level, rating and finished games are the same on each of its phones. Signing out keeps the profile and games on the phone.

**History sync**: keeping the phone's finished games and the account's records on the server the same (`HistorySync`). It **claims** games played signed out for the account, sends the ones not sent yet and reads back those from the account's other phones. _Avoid_: backup, cloud save.

**Family**: the players who share an online server: signed-in accounts joined with the family code; they see each other's games in the lobby.
