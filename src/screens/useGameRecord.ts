import { useEffect, useRef } from 'react';
import { finishedGame } from '../go/finished';
import { botRating } from '../go/rating';
import { GameState, RULES_VERSION } from '../go/rules';
import { GameMeta, savedGame } from '../go/saved';
import { botLevel, botNetOf, ratedAfter, Session } from '../go/session';
import { addFinished, KeptGame, loadGameMeta, Profile, randomId, saveGame } from '../ui/prefs';

/**
 * Keeps the game on this phone: saved after every move, since Android may stop the app at any time in
 * the background, and once finished kept as a record until the server has it, with the rating it moved.
 * A game in which the Coach was on during one of the player's turns (`coachOn`) moves no rating; the
 * returned `coached` says so for the game on this phone. Nor does a game against the bot in which the player
 * took a move back: `takeBack` marks it before the undo, and `tookBack` says so. `ratedFrom` is the rating
 * the finished game on this phone started from, when it moved the rating.
 */
export function useGameRecord(
  session: Session,
  /** The account the phone is signed in to: a game finished signed in is that player's. */
  player: string | undefined,
  profile: Profile,
  setProfile: (p: Profile) => void,
  setKept: (games: KeptGame[]) => void,
  coachOn: boolean,
): { coached: boolean; tookBack: boolean; ratedFrom: number | null; takeBack: () => void } {
  // The game's id, when its first move was made, and the rating it started with. A finished game
  // against the bot moves the rating once; a recount after fixing dead stones recalculates from the
  // rating the game started with and replaces the game's record.
  const restoredMeta = useRef(loadGameMeta());
  const gameMeta = useRef<{ start: GameState; before: Profile; recorded: GameState | null } & GameMeta>(null);
  const rated = useRef<{ game: GameState; from: number } | null>(null);
  useEffect(() => {
    const start = session.history[0] ?? session.game;
    if (gameMeta.current?.start !== start) {
      const meta = restoredMeta.current ?? { id: randomId(), startedAt: null };
      restoredMeta.current = null;
      gameMeta.current = { start, before: profile, recorded: null, ...meta };
    }
    const m = gameMeta.current;
    if (!m.startedAt && session.game.moves.length > 0) m.startedAt = new Date().toISOString();
    if (coachOn && session.game.phase === 'playing') m.coached = true;
    const after = m.coached || m.tookBack ? null : ratedAfter(session, m.before);
    if (session.game.phase === 'over' && m.recorded !== session.game) {
      m.recorded = session.game;
      const vsBot = session.settings.opponent === 'ai';
      const record = finishedGame(session.game, {
        id: m.id,
        mode: vsBot ? 'bot' : 'face_to_face',
        rules: RULES_VERSION,
        startedAt: m.startedAt,
        endedAt: new Date().toISOString(),
        player,
        you: vsBot ? session.settings.humanColor : null,
        coached: m.coached,
        tookBack: vsBot && m.tookBack,
        ...(after
          ? {
              rating: {
                before: m.before.rating,
                after: after.rating,
                opponent: botRating(botLevel(session.settings), session.game.size, botNetOf(session.settings)),
              },
            }
          : {}),
      });
      if (record) setKept(addFinished(record));
      // Only a new result moves the rating, so starting the rating again afterwards sticks.
      rated.current = after ? { game: session.game, from: m.before.rating } : null;
      if (after) setProfile({ ...profile, ...after });
    }
  }, [session, player, profile, setProfile, setKept, coachOn]);
  useEffect(() => saveGame(savedGame(session, gameMeta.current ?? undefined)), [session, coachOn]);
  return {
    coached: !!gameMeta.current?.coached,
    tookBack: !!gameMeta.current?.tookBack,
    ratedFrom: rated.current?.game === session.game ? rated.current.from : null,
    takeBack: () => {
      if (gameMeta.current && session.settings.opponent === 'ai') gameMeta.current.tookBack = true;
    },
  };
}
