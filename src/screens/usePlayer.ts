import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { instant } from '../go/finished';
import { Level, withLevel } from '../go/rating';
import { build } from '../config';
import type { Account, GoApi } from '../net/api';
import { Lobby, LobbyProblem, LobbyState } from '../net/lobby';
import { reporter } from '../report/install';
import { KeptGame, loadFinished, loadHistoryHolder, loadProfile, Profile, saveProfile, takeStartPending } from '../ui/prefs';
import { listed, ratingWithUnsent } from './history';
import { HistoryState, HistorySync, phoneHistory } from './historySync';

/** A profile whose rating never started again: all its rated games count. */
const ALWAYS = '1970-01-01T00:00:00.000Z';

/**
 * The player holding the phone. There is one profile and one set of games per phone; signing in
 * links them to an account so the family sees the same name, animal, level and rating, and the
 * same finished games on each of the account's phones.
 */
export function usePlayer({
  account,
  connection,
  startChoices,
}: {
  account: Account | null;
  connection: GoApi | null;
  startChoices: (level: Level) => void;
}) {
  const owner = account?.id;
  // The account's level arrives in an effect; the latest function is called, without re-running it.
  const start = useRef(startChoices);
  start.current = startChoices;
  const [profile, setProfileState] = useState<Profile>(loadProfile);
  const setProfile = useCallback((p: Profile) => {
    saveProfile(p);
    setProfileState(p);
  }, []);
  const latest = useRef(profile);
  latest.current = profile;
  const [allKept, setAllKept] = useState(loadFinished);
  const lobby = useMemo(
    () => (connection && owner ? new Lobby(connection, (e) => reporter.captureError(e, 'error', 'lobby')) : null),
    [owner, connection],
  );
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(() => lobby?.state() ?? null);
  useEffect(() => {
    setLobbyState(lobby?.state() ?? null);
    if (!lobby) return;
    const stop = lobby.subscribe(setLobbyState);
    void lobby.refresh();
    return stop;
  }, [lobby]);
  const me = lobbyState?.me ?? null;
  // The family's name and animal are what the other phones show, so they win, unless the family has
  // no animal yet: then this phone's goes up.
  const met = useRef<string | null>(null);
  useEffect(() => {
    if (!lobby || !me) return;
    if (met.current !== me.id) {
      met.current = me.id;
      if (!me.avatar && profile.avatar) void lobby.reportAvatar(profile.avatar);
    }
    if (me.name !== profile.name || (!!me.avatar && me.avatar !== profile.avatar)) {
      setProfile({ ...profile, name: me.name, avatar: me.avatar ?? profile.avatar });
    }
  }, [lobby, me, profile, setProfile]);

  const history = useMemo(
    () =>
      connection && owner
        ? new HistorySync(connection, owner, phoneHistory, build.version, (e) => reporter.captureError(e, 'error', 'history'))
        : null,
    [owner, connection],
  );
  const [synced, setSynced] = useState<HistoryState | null>(null);
  useEffect(() => {
    setSynced(null);
    if (!history) return;
    const stop = history.subscribe((s) => {
      setAllKept([...s.kept]);
      if (s.synced) setSynced(s);
    });
    void history.sync();
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void history.sync();
    });
    return () => {
      stop();
      app.remove();
      history.stop();
    };
  }, [history]);
  // Joining the family makes the phone's games the account's.
  const memberId = me?.id;
  useEffect(() => {
    if (memberId) void history?.sync();
  }, [history, memberId]);
  // The level chosen last, on any of the account's phones, wins. The rating is the server's, worked
  // out from the games it has, moved by the ones this phone has still to send.
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const server = synced?.me;
    if (!history || !owner || !server) return;
    const p = latest.current;
    const mine = instant(p.ratingSince ?? ALWAYS) ?? 0;
    const theirs = server.level && server.rating_since !== null ? instant(server.rating_since) : null;
    if (!server.level || server.rating === null || theirs === null || mine > theirs) {
      const since = p.ratingSince ?? ALWAYS;
      const key = `${server.id} ${p.level} ${since}`;
      if (reported.current === key) return;
      reported.current = key;
      void history.reportLevel(p.level, since).then((told) => {
        if (!told && reported.current === key) reported.current = null;
      });
      return;
    }
    const { rating, games } = ratingWithUnsent(
      { rating: server.rating, rated_games: server.rated_games, rating_since: server.rating_since! },
      synced.kept,
      owner,
    );
    const next = { ...p, level: server.level, ratingSince: server.rating_since!, rating, games };
    // A player back on a new phone starts its choices from the level their account brings.
    if (takeStartPending()) start.current(server.level);
    if (next.level !== p.level || next.ratingSince !== p.ratingSince || next.rating !== p.rating || next.games !== p.games)
      setProfile(next);
  }, [history, owner, synced, setProfile]);

  /** A finished game was kept on the phone: listed now, and sent when the account is in the family. */
  const setKept = useCallback(
    (games: KeptGame[]) => {
      setAllKept(games);
      void history?.sync();
    },
    [history],
  );
  // The games of the player whose games the phone holds; another account's unsent games wait unlisted.
  const kept = useMemo(() => listed(allKept, loadHistoryHolder()), [allKept]);
  /** The player chose a level: their rating starts again from it, on every phone of their account. */
  const restartRating = (level: Level, from: Profile = profile): Profile => {
    const since = new Date().toISOString();
    const next = { ...withLevel(from, level), ratingSince: since };
    setProfile(next);
    if (history) void history.reportLevel(level, since);
    return next;
  };
  const [joinProblem, setJoinProblem] = useState<LobbyProblem | null>(null);
  /**
   * Finishes the welcome. With a family code (once signed in) the player joins the family first, and
   * a refusal keeps them on the welcome with the problem.
   */
  const welcome = async (name: string, level: Level, avatar: string | null, code?: string): Promise<LobbyProblem | null> => {
    if (code && lobby && !me) {
      if (!(await lobby.register(name, code))) return lobby.state().problem ?? 'failed';
    }
    const named = { ...profile, name, ...(avatar ? { avatar } : {}) };
    if (level === profile.level) setProfile(named);
    else restartRating(level, named);
    takeStartPending();
    startChoices(level);
    return null;
  };
  const joinFromProfile = async (code: string): Promise<LobbyProblem | null> => {
    if (!lobby || !profile.name) return 'failed';
    const joined = await lobby.register(profile.name, code);
    const problem = joined ? null : lobby.state().problem;
    setJoinProblem(problem);
    return problem;
  };
  const rename = async (name: string): Promise<LobbyProblem | null> => {
    if (lobby && me && name !== me.name && !(await lobby.rename(name))) return lobby.state().problem;
    setProfile({ ...profile, name });
    return null;
  };
  const changeAvatar = async (avatar: string | null): Promise<LobbyProblem | null> => {
    if (lobby && me && !(await lobby.changeAvatar(avatar))) return lobby.state().problem;
    setProfile({ ...profile, avatar: avatar ?? undefined });
    return null;
  };
  return {
    profile,
    setProfile,
    restartRating,
    kept,
    setKept,
    lobby,
    lobbyState,
    me,
    joinProblem,
    welcome,
    joinFromProfile,
    rename,
    changeAvatar,
  };
}
