import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { ShipporiMincho_800ExtraBold } from '@expo-google-fonts/shippori-mincho/800ExtraBold';
import Ionicons from '@expo/vector-icons/Ionicons';

import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { formedTerritory, territoryRegions } from './src/go/count';
import { Color, EMPTY, GameState } from './src/go/rules';
import { Action, Opponent, reduce, Settings, startSession, botHandicap, botLevel, botNetOf, levelFor } from './src/go/session';
import { botRating, rankName } from './src/go/rating';
import { versionLabel } from './src/config';
import type { Account } from './src/net/api';
import { useAccount } from './src/screens/useAccount';
import { api } from './src/net/client';
import { reporter, setReportContext } from './src/report/install';
import { isNewer, onlineGameOf, replayFinished } from './src/go/finished';
import { HubOnline, MainHub } from './src/screens/MainHub';
import { useGameRecord } from './src/screens/useGameRecord';
import { useMoveInput } from './src/screens/useMoveInput';
import { usePlayer } from './src/screens/usePlayer';
import { opponentIn, useOnlineMatch, watchLobby } from './src/screens/onlineMatch';
import { sendReports, useReportSending } from './src/screens/reports';
import { points, rankNote } from './src/ui/copy';
import { language as currentLanguage, t } from './src/ui/i18n';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { FeedbackSheet } from './src/ui/FeedbackSheet';
import { resultCue } from './src/ui/cues';
import { BOARD_EDGE, GoBoard } from './src/ui/GoBoard';
import { IconButton } from './src/ui/Buttons';
import { HelpSheet } from './src/ui/HelpSheet';
import { useReduceMotion } from './src/ui/motion';
import { GuideSheet, OptionsSettings, OptionsSheet } from './src/ui/OptionsSheet';
import { loadGame, loadOnlineGame, saveOnlineGame } from './src/ui/prefs';
import { usePrefs } from './src/ui/usePrefs';
import { usePassWarning, useSessionWork } from './src/ui/slices';
import { FacingButtons, GameControls, useTapGuard } from './src/screens/GameControls';
import { useGuide } from './src/ui/useGuide';
import { useNetHints } from './src/ui/useNetHints';
import { useScoreEstimate } from './src/ui/useScoreEstimate';
import { PlayerCard } from './src/ui/PlayerCard';
import { BotSheet } from './src/screens/BotSheet';
import { MemberSheet } from './src/screens/MemberSheet';
import { humanStyleAt } from './src/go/human';
import { TextBand } from './src/ui/TextBand';
import { gameSummary, passedText } from './src/screens/gameText';
import { opponentStatus } from './src/screens/onlineText';
import { useShownGame } from './src/screens/shownGame';
import { useScoreCount } from './src/ui/ScoreCount';
import { colors, fonts, territoryTint } from './src/ui/theme';
import { loadSounds, play } from './src/ui/sound';
import { haptic } from './src/ui/haptics';
import { BoardNote, useGameCues } from './src/ui/useGameCues';
import { humanNetAvailable, netAvailable } from './modules/go-net';

loadSounds();

export default function App() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    ShipporiMincho_800ExtraBold,
    ...Ionicons.font,
  });
  const account = useAccount();
  if (!loaded || account === undefined) return <View style={styles.screen} />;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ErrorBoundary onError={(e, stack) => reporter.captureError(e, 'crash', `render${stack.slice(0, 1500)}`)}>
        <Game account={account} />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function Game({ account }: { account: Account | null }) {
  const accountId = account?.id;
  const connection = useMemo(() => (accountId && api ? api.forAccount(accountId) : null), [accountId]);
  const [session, rawDispatch] = useReducer(reduce, undefined, () => loadGame() ?? startSession());
  // The board shows a redo differently from a new move, so it is told which the latest change was.
  const lastAction = useRef<Action['type'] | null>(null);
  const dispatch = useCallback((a: Action) => {
    reporter.breadcrumb(describeAction(a));
    lastAction.current = a.type;
    rawDispatch(a);
  }, []);
  const [showOptions, setShowOptions] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showBot, setShowBot] = useState(false);
  const [shownMember, setShownMember] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHub, setShowHub] = useState(true);
  // Until a game has been started or restored, the menu has no game under it to close to.
  const [boardInUse, setBoardInUse] = useState(() => session.game.moves.length > 0 || !!loadOnlineGame(accountId));
  const [hubView, setHubView] = useState<'home' | 'online' | 'profile' | Opponent>('home');
  // Whether the game's New game opened the menu, so that its back arrow returns to the game.
  const [hubFromGame, setHubFromGame] = useState(false);
  // The online game on screen, or null for the game on this phone.
  const [onlineId, setOnlineId] = useState(() => loadOnlineGame(accountId));
  useEffect(() => saveOnlineGame(accountId, onlineId), [accountId, onlineId]);
  // A finished game from the profile's list shown for review, which takes the place of any other game on screen.
  const [reviewId, setReviewId] = useState<string | null>(null);
  // An online game belongs to the account that opened it.
  const [onlineAccount, setOnlineAccount] = useState(accountId);
  if (onlineAccount !== accountId) {
    setOnlineAccount(accountId);
    setOnlineId(null);
  }
  const prefs = usePrefs();
  const {
    teaching,
    confirmMoves,
    countSteps,
    showLiberties,
    showGroups,
    starPoints,
    showTerritory,
    scoreEstimate,
    likelyAreas,
    showRanks,
  } = prefs;
  const {
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
  } = usePlayer({
    account,
    connection,
    startChoices: prefs.startFor,
  });
  const ranks = showRanks;
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  const online = useOnlineMatch(connection, onlineId, me?.id ?? null, {
    profile,
    onRated: setProfile,
    onKept: setKept,
    ratingOf: (id) => lobbyState?.ratingOf(id) ?? null,
  });
  /** Another game with the same settings, apart from `changes`. */
  const restart = (changes: Partial<Settings> = {}) => dispatch({ type: 'configure', changes });
  const openHub = (view: 'home' | 'online' | 'profile' | Opponent, fromGame = false) => {
    setHubView(view);
    setHubFromGame(fromGame);
    setShowHub(true);
  };
  const openOnline = (id: string | null) => {
    if (!id) return;
    // One game at a time: the lobby asked before giving up the game on this phone.
    if (unfinished) restart();
    setReviewId(null);
    setOnlineId(id);
    setBoardInUse(true);
    setShowHub(false);
  };
  const openReview = (id: string) => {
    const record = kept.find((k) => k.game.id === id)?.game;
    if (!record || isNewer(record) || !replayFinished(record).ok) return;
    setReviewId(id);
    setBoardInUse(true);
    setShowHub(false);
  };
  const reviewing = kept.find((k) => k.game.id === reviewId)?.game;
  // The game on screen: the one under review, else the online game when one is open, otherwise the one on this phone.
  const shown = useShownGame({
    session,
    dispatch,
    lastAction: lastAction.current,
    online,
    lobby,
    lobbyState,
    profile,
    me,
    onNewGame: () => restart(),
    onOpened: openOnline,
    onCancelled: () => {
      setOnlineId(null);
      openHub('online');
    },
    review:
      reviewing && !isNewer(reviewing)
        ? {
            record: reviewing,
            onDone: () => {
              setReviewId(null);
              openHub('profile');
            },
          }
        : null,
  });
  const { game, viewer, facing, canPlay, thinking, nameOf } = shown;
  const { settings } = session;
  const shownKey = shown.key;
  const ai = shown.bot;
  // The bot of the game on this phone; a finished game opened for review may have been against another level.
  const botHere = !!ai && !onlineId && !reviewId;
  // While an online game loads, the board is a placeholder, not the game: nothing to estimate yet.
  const projection = useScoreEstimate(game, (scoreEstimate || likelyAreas) && shown.loaded, shown.estimateKey, thinking);
  // The player holding the phone is at the bottom, their opponent at the top; face to face, Black sits at the bottom.
  const bottom: Color = viewer ?? 'black';
  const top: Color = bottom === 'black' ? 'white' : 'black';

  // Face to face: two people sit across the phone from each other, so White's card and texts sit at
  // the top, upside down, and each player's status and Guide advice appear at their own end.
  // A game someone would lose by starting another.
  const unfinished = session.game.phase !== 'over' && session.game.moves.length > 0;
  // Continue's game: the online one while it is open, otherwise the one on this phone.
  const onlineGame = online?.ready?.state.game;
  const them = online?.ready && me ? opponentIn(online.ready.row, me.id) : null;
  // The other player by their animal and name, once someone has joined.
  const against = (them && [lobbyState?.avatarOf(them), lobbyState?.nameOf(them)].filter(Boolean).join(' ')) || undefined;
  const current = onlineId
    ? onlineGame && onlineGame.phase !== 'over'
      ? { size: onlineGame.size, opponent: null, moves: onlineGame.moves.length, against }
      : null
    : unfinished
      ? { size: session.game.size, opponent: settings.opponent, moves: session.game.moves.length }
      : null;

  // The screen never scrolls. The board comes first: it takes nearly the full width as long as the
  // text beside it (one band below, or one at each end face to face) keeps room for a message.
  const [boardArea, setBoardArea] = useState(0);
  const maxBoardWidth = width - 2 * BOARD_GUTTER;
  // Against the bot or online, both cards sit in the same area as the board: theirs above it, yours below.
  const [theirCardHeight, setTheirCardHeight] = useState(0);
  const [yourCardHeight, setYourCardHeight] = useState(0);
  const besideBoard = facing ? 2 * (FACING_GAP + TEXT_MIN) : 4 * FACING_GAP + theirCardHeight + yourCardHeight + TEXT_MIN;
  // Without the Coach's advice there is nothing to make room for, so the cards and board sit in the middle while
  // the game is played; once it stops, the board moves up to leave the marking, count and result their room.
  // The Coach reads the game with the bot's network, so its ideas stay out of games between family members.
  const hint = teaching && netAvailable && !onlineId && !reviewId;
  // The Coach on during the player's turn makes the game on this phone unrated, even if switched off later.
  const { coached, tookBack, ratedFrom, takeBack } = useGameRecord(
    session,
    accountId,
    profile,
    setProfile,
    setKept,
    hint && canPlay && game.phase === 'playing',
  );
  const centered = !facing && !hint && game.phase === 'playing';
  const boardWidth = Math.max(0, Math.min(maxBoardWidth, boardArea - BOARD_EDGE - besideBoard));
  const needsConfirm = confirmMoves;

  useReportSending(me?.id);

  const { botStuck } = useSessionWork(session, dispatch, !!onlineId || !!reviewId);

  const { preview, onTap } = useMoveInput({ shown, needsConfirm });

  const countAnimated = countSteps && !reduceMotion;
  // Counting step by step, the count reveals the score; otherwise marking shows it as groups are toggled.
  const count = useScoreCount({
    game,
    animate: countAnimated,
    preview: !countSteps,
    onEnd: () => {
      const end = resultCue(game, viewer);
      play(end.sounds[0].name);
      if (end.haptic) void haptic(end.haptic);
    },
    gameKey: shownKey,
  });
  const guard = useTapGuard(game.phase, !!count.stepper);
  // Once the count has named the dead stones, they come off the board, flying to their captor's card.
  const boardGame = useMemo(
    () =>
      count.takenOff && game.dead.size
        ? { ...game, board: game.board.map((v, p) => (game.dead.has(p) ? EMPTY : v)), dead: new Set<number>() }
        : game,
    [game, count.takenOff],
  );
  const territory = useMemo(
    () => (game.phase === 'scoring' ? territoryRegions(game) : game.phase === 'playing' && showTerritory ? formedTerritory(game) : null),
    [game, showTerritory],
  );

  // Captured stones fly to the captor's card. Under area scoring they don't change the score, so the card keeps no count.
  const cardStones = useRef<Partial<Record<Color, { x: number; y: number }>>>({});
  const captureTarget = useCallback((c: Color) => cardStones.current[c] ?? null, []);

  const guide = useGuide(game, teaching && !onlineId, showLiberties);
  const netHints = useNetHints(game, hint, canPlay);
  // The idea the player tapped in the Guide's advice, shown on the board until the next move.
  const [shownIdea, setShownIdea] = useState<{ game: GameState; point: number } | null>(null);
  const spotlight = shownIdea?.game === game ? shownIdea.point : null;
  const showIdea = (p: number) => {
    setShownIdea(spotlight === p ? null : { game, point: p });
    void haptic('tick');
  };
  const { shakeStyle, note } = useGameCues(game, {
    refusal: shown.refusal,
    gameKey: shownKey,
    viewer,
    chimeForOpponent: shown.chimeForOpponent,
    deferResult: countAnimated,
    undone: shown.undone,
    passedText: (c) => passedText(shown.who(c)),
    refusedText: shown.refusedText,
  });
  /** Closes the options, then opens another sheet once it has gone. */
  const fromOptions = (open: () => void) => () => {
    setShowOptions(false);
    setTimeout(open, 250);
  };
  const watch = useCallback(() => (lobby && connection ? watchLobby(lobby, connection) : () => {}), [lobby, connection]);
  // During an online game the lobby keeps being watched: the other player's presence stays fresh and the family sees this phone's.
  useEffect(() => (onlineId && !showHub ? watch() : undefined), [onlineId, showHub, watch]);
  const hubOnline: HubOnline | null =
    lobby && lobbyState
      ? {
          state: lobbyState,
          watch,
          onRegister: (code) => lobby.register(profile.name ?? '', code),
          onCreate: (setup) => {
            choices.confirmMoves.set(setup.confirmMoves);
            const made = setup.ask
              ? lobby.ask(setup.ask, setup.size, setup.color, setup.handicap)
              : lobby.create(setup.size, setup.color, setup.handicap);
            void made.then(openOnline);
          },
          onOpen: (id) => void lobby.open(id).then(openOnline),
          onRefresh: () => void lobby.refresh(),
        }
      : null;

  /** The choices shown in Options, both in the sheet over a game and in the main menu. */
  const choices = prefs.choicesFor(game.size);

  const cardValue = (c: Color): { label?: string; value?: string } =>
    count.score ? { label: t('Score'), value: points(count.score.totals[c]) } : {};
  /** The rank beside a name against the bot, when ranks are shown. */
  const rankOf = (c: Color) =>
    ranks && ai ? ` · ${rankName(c === ai ? botRating(botLevel(settings), game.size, botNetOf(settings)) : profile.rating)}` : '';

  const statusLine = count.status ?? shown.status(preview);
  // A refused move is explained by a note over the board that fades, so the message beside it leaves it out.
  const shownStatus = count.status ?? shown.status(preview, true);
  const { warned: passWarned, passOrWarn } = usePassWarning(game, canPlay, shownKey);
  // Against the bot, a move taken back leaves the game unrated: the first undo of a rated game says so and waits for a second.
  const [undoWarnedAt, setUndoWarnedAt] = useState<string | null>(null);
  const undoKey = `${shownKey}:${game.moves.length}`;
  const undoWarned = undoWarnedAt === undoKey;
  const undo = shown.controls.undo;
  const controls =
    undo && botHere && !coached && !tookBack
      ? {
          ...shown.controls,
          undo: {
            ...undo,
            run: () => {
              if (!undoWarned) return setUndoWarnedAt(undoKey);
              setUndoWarnedAt(null);
              takeBack();
              undo.run();
            },
          },
        }
      : shown.controls;
  // Whose turn it is shows on the player cards; the status line is shown only when it says more than that.
  const plainTurn = game.phase === 'playing' && !count.stepper && shown.plainTurn(preview);
  const message =
    botStuck && !onlineId && !reviewId
      ? t('The bot can’t run on this phone.')
      : passWarned
        ? t('There’s still open space to claim. Tap Pass again to pass anyway.')
        : undoWarned
          ? t('Taking a move back means this game won’t count for your rating. Tap Undo again to take it back.')
          : plainTurn
            ? null
            : shownStatus;

  const report = shown.report;
  useEffect(() => {
    setReportContext(() => ({
      ...report,
      screen: {
        phase: game.phase,
        to_play: game.toPlay,
        captures: game.captures,
        move_count: game.moves.length,
        size: game.size,
        handicap: game.handicap,
        komi: game.komi,
        status: statusLine,
        players: { black: nameOf('black'), white: nameOf('white') },
      },
    }));
  }, [game, nameOf, statusLine, report]);
  const card = (c: Color) => (
    <PlayerCard
      key={c}
      color={c}
      name={nameOf(c) + rankOf(c)}
      avatar={shown.avatarOf(c)}
      // A finished game opened from the profile is only looked at: its cards open nothing.
      onAvatar={
        reviewId
          ? undefined
          : viewer === c
            ? guard(() => openHub('profile'))
            : botHere && c === ai
              ? () => setShowBot(true)
              : shown.memberOf(c)
                ? () => setShownMember(shown.memberOf(c))
                : undefined
      }
      avatarLabel={viewer === c ? undefined : botHere && c === ai ? t('About the bot') : t('About {name}', { name: nameOf(c) })}
      active={game.phase === 'playing' && game.toPlay === c}
      thinking={game.phase === 'playing' && game.toPlay === c && shown.waiting}
      {...cardValue(c)}
      secondary={!count.score}
      swatch={count.score ? territoryTint(c) : undefined}
      estimate={
        scoreEstimate && projection
          ? { value: points(projection[c]), leading: projection[c] > projection[c === 'black' ? 'white' : 'black'] }
          : null
      }
      onStonePage={(at) => {
        cardStones.current[c] = at;
      }}
    />
  );
  const result = game.phase === 'over' && count.done ? shown.result : null;
  // The online game's record on this phone holds the rating it moved, so the rank's move survives reopening it.
  // Until the game is kept, a moment after it ends, the result says nothing of the rating.
  const onlineKept = onlineId ? kept.find(({ game: g }) => onlineGameOf(g) === onlineId)?.game : undefined;
  const onlineRecord = onlineKept && !isNewer(onlineKept) ? onlineKept : undefined;
  const onlineRating = onlineRecord?.meta.rating;
  const textBand = (end: Color | null) => (
    <TextBand
      end={end}
      top={top}
      bottom={bottom}
      game={game}
      canPlay={canPlay}
      message={message}
      warning={shown.warning}
      result={result}
      resultNote={
        botHere && coached
          ? { text: t('Played with the Coach: not rated') }
          : botHere && tookBack
            ? { text: t('Moves taken back: not rated') }
            : onlineRecord && !onlineRating
              ? { text: t('Older game: not rated') }
              : ranks && onlineRating
                ? rankNote(onlineRating.after, onlineRating.before)
                : ranks && ai
                  ? rankNote(profile.rating, botHere ? ratedFrom : null)
                  : null
      }
      count={count}
      nameOf={nameOf}
      advice={netHints.advice}
      legend={netHints.legend}
      spotlight={spotlight}
      onIdea={showIdea}
      onFixDead={shown.fixDead}
      still={reduceMotion}
      style={[styles.textBand, centered && styles.textBandCentered]}
    />
  );
  /** Face to face, each player's end: their card and their own buttons on one line. */
  const facingEnd = (c: Color) => (
    <View style={[styles.facingEnd, c === 'white' && styles.flipped]}>
      {card(c)}
      {game.phase === 'playing' && !count.stepper && (
        <FacingButtons
          color={c}
          toPlay={game.toPlay}
          controls={controls}
          guard={guard}
          passOrWarn={passOrWarn}
          onOptions={() => setShowOptions(true)}
        />
      )}
    </View>
  );
  // Online, the other player's presence sits at the right of their card, or this phone's lost connection.
  const theirStatus = shown.reachable === null ? null : opponentStatus(shown.reachable, them, lobbyState);
  const opponentCard = (
    <View style={styles.topBarRow}>
      {card(top)}
      {theirStatus && (
        <View style={styles.connection} testID="online-connection" accessible accessibilityLabel={theirStatus.text ?? t('Connected')}>
          <Ionicons
            name={theirStatus.tone === 'offline' ? 'cloud-offline-outline' : 'cloud-done-outline'}
            size={20}
            color={theirStatus.tone === 'offline' ? colors.danger : theirStatus.tone === 'online' ? colors.online : colors.textMuted}
          />
          {theirStatus.text && (
            <Text style={[styles.connectionText, theirStatus.tone === 'offline' && styles.connectionLost]} numberOfLines={1}>
              {theirStatus.text}
            </Text>
          )}
        </View>
      )}
    </View>
  );
  const board = boardWidth > 0 && (
    <Animated.View style={[{ width: boardWidth }, styles.boardContainer, shakeStyle]}>
      <GoBoard
        game={boardGame}
        width={boardWidth}
        territory={count.regions ?? territory}
        projected={likelyAreas && projection ? projection.owner : null}
        counting={count.current}
        counted={count.points}
        areas={count.areas}
        coordinates={choices.coordinates.value}
        starPoints={starPoints}
        captureTarget={captureTarget}
        preview={preview}
        spotlight={spotlight}
        aimColor={canPlay ? game.toPlay : null}
        aimAtOnce={needsConfirm}
        showLiberties={guide.holdLiberties}
        groups={showGroups}
        note={guide.note}
        noteTo={facing ? BOTH_ENDS : null}
        ghosts={netHints.ghosts}
        outlines={netHints.outlines}
        liberties={guide.liberties}
        redone={shown.redone}
        language={currentLanguage()}
        onTap={onTap}
      />
      {facing && !note?.warning ? (
        // A pass concerns both players across the table: each gets a copy on their half of the board.
        <>
          <BoardNote note={note} place="low" />
          <BoardNote note={note} place="high" flip />
        </>
      ) : (
        <BoardNote note={note} flip={facing && game.toPlay === 'white'} />
      )}
    </Animated.View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.content, facing && styles.contentFacing]}>
        {/* From the count on, each end's score table names the players and their scores, so it takes the cards' room.
            Stones taken off at the count still fly to where the card was. */}
        {facing && game.phase !== 'over' && facingEnd('white')}
        {!facing && (
          <View style={styles.menuRow}>
            <IconButton label={t('Options')} icon="menu" testID="options" size={44} quiet onPress={() => setShowOptions(true)} />
          </View>
        )}
        <View
          style={[styles.boardArea, centered && styles.boardAreaCentered]}
          testID="board-area"
          onLayout={(e) => setBoardArea(e.nativeEvent.layout.height)}
        >
          {facing ? (
            <>
              {textBand(top)}
              {board}
              {textBand(bottom)}
            </>
          ) : (
            <>
              {centered && <View style={styles.centerSpacer} />}
              <View
                style={[styles.playerBay, styles.yourCard]}
                testID="their-card"
                onLayout={(e) => setTheirCardHeight(e.nativeEvent.layout.height)}
              >
                {opponentCard}
              </View>
              {board}
              <View
                style={[styles.playerBay, styles.yourCard]}
                testID="your-card"
                onLayout={(e) => setYourCardHeight(e.nativeEvent.layout.height)}
              >
                {card(bottom)}
              </View>
              {textBand(null)}
            </>
          )}
        </View>
        {facing && game.phase !== 'over' && facingEnd('black')}

        {(!facing || game.phase !== 'playing') && (
          <GameControls
            controls={controls}
            count={count}
            facing={facing}
            toMarking={shown.fixDead}
            guard={guard}
            passOrWarn={passOrWarn}
            onGuide={() => setShowGuide(true)}
            onOptions={() => setShowOptions(true)}
          />
        )}
      </View>

      <GuideSheet choices={choices} online={!!onlineId && !reviewId} visible={showGuide} onClose={() => setShowGuide(false)} />
      <OptionsSheet
        visible={showOptions}
        onClose={() => setShowOptions(false)}
        summary={gameSummary(shown.game.size, onlineId ? null : settings.opponent, shown.game.moves.length, reviewId ? undefined : against)}
        onSetup={
          onlineId && !reviewId
            ? fromOptions(() => openHub('online', true))
            : shown.newGame
              ? fromOptions(() => openHub(settings.opponent, true))
              : undefined
        }
        resignWarning={shown.resignWarning}
        onResign={fromOptions(shown.resign)}
        choices={choices}
        onSettings={fromOptions(() => setShowGuide(true))}
        onRules={fromOptions(() => setShowRules(true))}
        onFeedback={fromOptions(() => setShowFeedback(true))}
        onHub={fromOptions(() => openHub('home'))}
      />
      <MainHub
        visible={showHub}
        initialView={hubView}
        current={current}
        currentSetup={settings}
        profile={profile}
        rank={ranks ? rankName(profile.rating) : null}
        confirmMoves={confirmMoves}
        botHandicap={(size, level, net) => botHandicap(profile.rating, size, level, net)}
        botLevelFor={(size, net) => levelFor(profile.rating, size, net)}
        botRank={(size, level, net) => rankName(botRating(level, size, net))}
        humanBot={humanNetAvailable}
        coach={teaching && netAvailable}
        netBot={netAvailable}
        onName={rename}
        onWelcome={welcome}
        canJoin={!!api}
        account={account}
        family={me ? { member: true } : { member: false, problem: joinProblem }}
        onJoin={joinFromProfile}
        onRestartRating={(level) => restartRating(level)}
        onAvatar={changeAvatar}
        kept={kept}
        nameOf={(id) => lobbyState?.nameOf(id)}
        onOpenGame={openReview}
        onResume={() => {
          setReviewId(null);
          setShowHub(false);
        }}
        onClose={boardInUse ? () => setShowHub(false) : undefined}
        onSetupBack={
          hubFromGame
            ? () => {
                setShowHub(false);
                setTimeout(() => setShowOptions(true), 250);
              }
            : undefined
        }
        onStartGame={(changes, extras) => {
          setReviewId(null);
          setOnlineId(null);
          setBoardInUse(true);
          setShowHub(false);
          choices.confirmMoves.set(extras.confirmMoves);
          // The Coach helps a lot, so it comes on with the beginner game rather than with a level; Territory with it.
          if (extras.beginner) {
            choices.teaching.set(true);
            choices.showTerritory.set(true);
          }
          restart(changes);
        }}
        online={hubOnline}
        onRules={() => setShowRules(true)}
        onFeedback={() => setShowFeedback(true)}
        settings={<OptionsSettings choices={choices} />}
        language={choices.language}
      />
      <HelpSheet visible={showRules} onClose={() => setShowRules(false)} />
      <MemberSheet
        visible={!!shownMember}
        onClose={() => setShownMember(null)}
        player={lobbyState?.playerOf(shownMember) ?? undefined}
        online={!!shownMember && !!lobbyState?.isOnline(shownMember)}
        now={lobbyState?.now() ?? Date.now()}
        myRating={profile.rating}
      />
      {botHere && (
        <BotSheet
          visible={showBot}
          onClose={() => setShowBot(false)}
          level={botLevel(settings)}
          size={game.size}
          style={humanNetAvailable && botNetOf(settings) === 'human' ? humanStyleAt(game.size, botLevel(settings)) : null}
        />
      )}
      <FeedbackSheet
        visible={showFeedback}
        allowed={!!me}
        onSignIn={() => {
          setShowFeedback(false);
          openHub('profile');
        }}
        version={versionLabel}
        onClose={() => setShowFeedback(false)}
        onSubmit={(kind, text) => {
          reporter.feedback(kind, text);
          return me ? sendReports(me.id) : Promise.resolve(false);
        }}
      />
    </SafeAreaView>
  );
}

/** A short description of a player action, kept as context for error reports. */
function describeAction(a: Action): string {
  if (a.type === 'tap') return `tap ${a.point}`;
  if (a.type === 'ai') return `ai ${a.decision.kind === 'play' ? a.decision.point : a.decision.kind}`;
  if (a.type === 'configure') return `configure ${JSON.stringify(a.changes)}`;
  return a.type;
}

/** Side padding of the strips and buttons; the board reaches closer to the screen edge. */
const SCREEN_GUTTER = 12;
const BOARD_GUTTER = 3;
/** The least height a text band keeps beside the board, however short the screen: a two-line message. */
const TEXT_MIN = 46;
/** Face to face, both players see the Guide's notes, each at their own end. */
const BOTH_ENDS: readonly Color[] = ['black', 'white'];
const FACING_GAP = 6;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: SCREEN_GUTTER, paddingTop: 6, paddingBottom: 10, gap: 8 },
  playerBay: {
    flexDirection: 'row',
    width: '100%',
    alignSelf: 'center',
  },
  // Inside the board's area, which reaches closer to the screen edge; this lines the card up with the one above.
  yourCard: { paddingHorizontal: SCREEN_GUTTER - BOARD_GUTTER },
  // On the line of the name beside it: the card's padding, then the height of its name row.
  connection: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 4, flexShrink: 0, marginTop: 2, height: 20 },
  connectionText: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted },
  connectionLost: { color: colors.danger },
  topBarRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  // The menu has the top right corner of the screen to itself.
  menuRow: { alignItems: 'flex-end' },
  // The text bands and the board are centred together.
  boardArea: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: FACING_GAP,
    marginHorizontal: BOARD_GUTTER - SCREEN_GUTTER,
  },
  boardContainer: {
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 12,
  },
  contentFacing: { gap: 8 },
  flipped: { transform: [{ rotate: '180deg' }] },
  textBand: { paddingHorizontal: SCREEN_GUTTER },
  facingEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
  },
  // Without Teaching, a spacer above and the text below share the free height, centring the cards and board.
  boardAreaCentered: { justifyContent: 'flex-start' },
  centerSpacer: { flex: 1 },
  textBandCentered: { minHeight: TEXT_MIN, justifyContent: 'flex-start' },
});
