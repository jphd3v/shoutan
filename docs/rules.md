# Rules

Shoutan plays the Chinese rules as the Chinese Weiqi Association wrote them in 2002, and only those. The original is in Chinese ([text](https://cwqa.qilue.com/rules/)). There are English translations by Guo Juan 5p, published by the [Singapore Weiqi Association](https://weiqi.org.sg/wp-content/uploads/2025/09/The-Chinese-Rules-of-Weiqi.pdf), and by [Robert Jasiek](https://home.snafu.de/jasiek/c2002.pdf). The article numbers below are the original's, and `src/go/__tests__/rules.test.ts` tests each rule, quoting its article in Chinese. The text covers even games on 19×19 only, so handicap follows the established Chinese custom and the smaller boards follow common practice.

## The board and komi

You play on a 9×9, 13×13 or 19×19 board. Black plays first. White gets 7½ points of komi, which is 3¾ stones in the Chinese count (art. 11), so a game can't end in a tie.

## Handicap

With one handicap stone, Black plays first on an empty board and White gets ½ point of komi. With two or more, the stones go on the star points in the usual order: two opposite corners, the other two corners, then the centre for an odd number and the sides from six stones on. White then plays first.

White's komi is then a point per stone plus ½. That follows the Chinese custom of Black returning half a stone for each handicap stone, and the ½ again rules out a tie. You can have at most nine stones on 13×13 and 19×19, and five on 9×9, where the star points run out.

## Captures, suicide and repetition

A chain with no liberties, meaning no empty points next to it, is captured. The app shows how many stones each player has captured.

Suicide is illegal (art. 5). A move that leaves your own chain without liberties is allowed only if it captures.

A move may not make the opponent face a position that has occurred before: the same board with the same player to move (art. 6). That covers simple ko and longer cycles such as a triple ko. Passing is always allowed.

## Passing and the end of play

Passing costs nothing, and two passes in a row end play (arts. 2.5 and 7). Then the stones are marked:

- The app marks the stones it judges dead.
- Tapping a chain marks it dead or alive again.
- Count ends the game.
- Keep playing goes back to the game, so a disputed group can be settled on the board (art. 21.4). The rules have the side that says the stones are dead move first. The app can't tell who said what, so play resumes with the player whose turn it was.

## Counting

The game is scored by area (art. 9). The dead stones come off. Each side then scores its live stones plus the empty points surrounded only by its own stones. Empty points between both sides' stones, the dame and a seki's shared liberties, count half for each side. An eye inside a seki counts for its owner. You don't need to fill the dame: filling them changes the margin only when one side fills more than the other.

During the count, squares mark the points each side gets. A square split into black and white gives half a point to each side. The marks stay on the final board.

## Winning

On 19×19, Black needs more than 184¼ of the 361 points (arts. 9 and 11). The app gives the margin in points, which is twice the margin in stones (子) of the Chinese count. So 184½ points for Black is a win by ¼ stone, or ½ point.

## Resigning

Resign is in the ☰ menu while a game is on. The app asks once more, then ends the game. Face to face, the player to move resigns.
