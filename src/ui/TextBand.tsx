import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import type { Breakdown } from '../go/count';
import type { GroupStatus } from '../go/netHints';
import type { Color, GameState } from '../go/rules';
import { GhostStone } from './board/ghost';
import { OUTLINE_DASH, OUTLINE_LOOK } from './board/GroupOutlines';
import { AdviceText, outlineText, ResultNote } from './copy';
import { t } from './i18n';
import { ResultPanel } from './ResultPanel';
import { CountLegend, MarkingLegend, ScoreTable, useScoreCount } from './ScoreCount';
import { colors, fonts, radius } from './theme';

type Advice = AdviceText | null;

/**
 * The text beside the board: a message when there is one, otherwise the Guide's advice; the scores
 * once the game is counted. Face to face each player has their own `end`; otherwise one band below
 * (`end` null).
 */
export function TextBand({
  end,
  top,
  bottom,
  game,
  canPlay,
  message,
  warning,
  result,
  resultNote,
  count,
  nameOf,
  advice,
  legend = [],
  spotlight,
  onIdea,
  onFixDead,
  still,
  style,
}: {
  end: Color | null;
  top: Color;
  bottom: Color;
  game: GameState;
  canPlay: boolean;
  message: string | null;
  /** The message reports a problem. */
  warning: boolean;
  result: { title: string; subtitle: string } | null;
  resultNote: ResultNote | null;
  count: ReturnType<typeof useScoreCount>;
  nameOf: (c: Color) => string;
  advice: Advice;
  /** What the Coach's outlines on the board mean. */
  legend?: readonly GroupStatus[];
  spotlight: number | null;
  onIdea: (point: number) => void;
  /** Goes back to marking dead stones after the count, on the band below only. */
  onFixDead?: () => void;
  still: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isTop = end === top;
  const suffix = isTop ? '-top' : '';
  // Face to face each end reads its own score first, then the other player's.
  const shown: readonly Color[] = end ? [end, end === top ? bottom : top] : [top, bottom];
  const yourTurn = game.phase === 'playing' && (end ? game.toPlay === end : canPlay);
  const scoreRows = (b: Record<Color, Breakdown>) => shown.map((c) => ({ color: c, name: nameOf(c), score: b[c] }));
  const adviceView = (framed: boolean) =>
    advice && (
      <>
        <AdviceView advice={advice} color={game.toPlay} framed={framed} spotlight={spotlight} onIdea={onIdea} />
        {legend.length > 0 && <OutlineLegend statuses={legend} />}
      </>
    );
  return (
    <View style={[styles.textBand, !!end && styles.textBandFacing, isTop && styles.flipped, style]}>
      {!result && (yourTurn || game.phase !== 'playing' || !end) && message && (
        <Text
          style={[styles.status, warning && styles.statusWarning]}
          testID={`status${suffix}`}
          numberOfLines={3}
          accessibilityLiveRegion="polite"
        >
          {message}
        </Text>
      )}
      <ScrollView
        style={styles.textScroll}
        contentContainerStyle={[styles.textScrollContent, !!end && styles.textBandFacing]}
        showsVerticalScrollIndicator={false}
      >
        {result ? (
          <>
            <ResultPanel
              {...result}
              note={resultNote}
              rows={count.score ? scoreRows(count.score.breakdown) : null}
              compact={!!end}
              you={end}
              onFixDead={end ? undefined : onFixDead}
              still={still}
              suffix={suffix}
            />
            {/* Players still look over the board's marks once the count has ended. */}
            {count.points && (
              <CountLegend shared={!!count.points?.shared.length} komi={game.komi} dead={false} testID={`count-legend${suffix}`} />
            )}
          </>
        ) : (
          <>
            {count.stepper && (
              <CountLegend
                shared={!!count.points?.shared.length}
                komi={game.komi}
                dead={game.dead.size > 0}
                testID={`count-legend${suffix}`}
              />
            )}
            {game.phase === 'scoring' && (game.dead.size > 0 || !!game.unsure?.size) && (
              <MarkingLegend dead={game.dead.size > 0} unsure={!!game.unsure?.size} testID={`marking-legend${suffix}`} />
            )}
            {game.phase === 'playing'
              ? yourTurn && !message && (end ? adviceView(false) : <Tutorial>{adviceView(true)}</Tutorial>)
              : count.score && (
                  <ScoreTable rows={scoreRows(count.score.breakdown)} adding={count.current} suffix={suffix} compact={!!end} you={end} />
                )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * The Guide's advice as plain text beside the board, not a card: only the ideas can be tapped, to show
 * where they mean. `framed` draws it in the faint tutorial frame, whose corner carries the light bulb instead.
 */
function AdviceView({
  advice,
  color,
  framed,
  spotlight,
  onIdea,
}: {
  advice: NonNullable<Advice>;
  /** The player to move, whose ghost stones the ideas are. */
  color: Color;
  framed: boolean;
  spotlight: number | null;
  onIdea: (point: number) => void;
}) {
  // Advice, even about stones in danger, is a tip rather than an error, so it never looks like a refused move.
  const adviceIcon = <Ionicons name="bulb-outline" size={18} color={colors.accent} style={styles.adviceIcon} testID="guide-idea-icon" />;
  const { note } = advice;
  const body = advice.ideas.length ? (
    <View
      style={styles.advice}
      testID={advice.ideas.length > 1 ? 'guide-ideas' : undefined}
      accessibilityLabel={advice.ideas.length > 1 ? advice.text : undefined}
    >
      {advice.ideas.map((idea, i) => {
        const shown = idea.point === spotlight;
        return (
          <Pressable
            key={idea.point}
            testID={advice.ideas.length > 1 ? undefined : 'guide-ideas'}
            accessibilityRole="button"
            accessibilityLabel={idea.text}
            accessibilityHint={t('Shows where on the board')}
            accessibilityState={{ selected: shown }}
            onPress={() => onIdea(idea.point)}
            style={({ pressed }) => [styles.adviceRow, shown && styles.adviceShown, pressed && styles.advicePressed]}
          >
            <View style={styles.ideaMarker}>
              <GhostStone color={color} size={24} number={advice.ideas.length > 1 ? i + 1 : undefined} shown={shown} />
            </View>
            <Text style={styles.adviceText}>{idea.sentence}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : (
    <View style={[styles.advice, styles.adviceRow]}>
      {!framed && adviceIcon}
      <Text style={styles.adviceText} testID="guide-ideas">
        {advice.text}
      </Text>
    </View>
  );
  return note ? (
    <View style={styles.advice}>
      {note.point === undefined ? (
        <Text style={styles.adviceText} testID="guide-note-idea">
          {note.text}
        </Text>
      ) : (
        <Pressable
          testID="guide-note-idea"
          accessibilityRole="button"
          accessibilityLabel={note.text}
          accessibilityHint={t('Shows where on the board')}
          accessibilityState={{ selected: note.point === spotlight }}
          onPress={() => onIdea(note.point!)}
          style={({ pressed }) => [styles.adviceRow, note.point === spotlight && styles.adviceShown, pressed && styles.advicePressed]}
        >
          <Text style={styles.adviceText}>{note.text}</Text>
        </Pressable>
      )}
      {body}
    </View>
  ) : (
    body
  );
}

/** What each kind of outline on the board means: a short dashed line in its look, then the sentence. */
function OutlineLegend({ statuses }: { statuses: readonly GroupStatus[] }) {
  const w = 28;
  return (
    <View style={styles.legend} testID="outline-legend">
      {statuses.map((s) => {
        const look = OUTLINE_LOOK[s];
        return (
          <View key={s} style={styles.legendRow}>
            <Svg width={w} height={10}>
              <Line
                x1={1}
                y1={5}
                x2={w - 1}
                y2={5}
                stroke={look.stroke}
                strokeWidth={Math.max(2, look.width * 40)}
                strokeDasharray={look.dashed ? OUTLINE_DASH.map((d) => d * 30).join(' ') : undefined}
              />
            </Svg>
            <Text style={styles.legendText}>{outlineText(s)}</Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A faint frame marking Teaching's advice as the tutorial area, with a small light bulb set into its top edge
 * like a label, so it reads as a panel and not a button. Face to face has no room for it.
 */
function Tutorial({ children }: { children: ReactNode }) {
  return (
    children && (
      <View style={styles.tutorial} testID="guide-frame">
        <View style={styles.tutorialBadge}>
          <Ionicons name="bulb-outline" size={14} color={colors.accent} testID="guide-idea-icon" />
        </View>
        {children}
      </View>
    )
  );
}

const styles = StyleSheet.create({
  status: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, color: colors.textMuted, textAlign: 'center', flexShrink: 0 },
  statusWarning: { color: colors.danger },
  flipped: { transform: [{ rotate: '180deg' }] },
  // Face to face the two ends share the height evenly, so the board stays put as turns change.
  textBand: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  textScroll: { flexGrow: 0, flexShrink: 1, alignSelf: 'stretch' },
  textScrollContent: { alignItems: 'center', gap: 6 },
  // Each end face to face has only the height the full-width board leaves: the count's status, legend and score table share it.
  textBandFacing: { gap: 2 },
  advice: { alignSelf: 'stretch', gap: 8 },
  tutorial: {
    alignSelf: 'stretch',
    marginTop: 8,
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 168, 56, 0.22)',
    borderRadius: radius.md,
  },
  // Sits on the frame's top edge; the screen's own colour behind it cuts the line, as a legend does.
  tutorialBadge: {
    position: 'absolute',
    top: -9,
    left: 12,
    paddingHorizontal: 4,
    backgroundColor: colors.background,
  },
  adviceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  legend: { alignSelf: 'stretch', gap: 4, marginTop: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.textMuted },
  advicePressed: { opacity: 0.6 },
  // Centred on the first line of text.
  adviceIcon: { marginTop: 1, width: 22, textAlign: 'center' },
  adviceText: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.text },
  // The tapped idea's row: a soft green band that reaches past the text without moving it.
  adviceShown: {
    backgroundColor: colors.ideaSoft,
    borderRadius: radius.sm,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    marginVertical: -4,
    paddingVertical: 4,
  },
  // A small copy of the ghost stone on the board, so each sentence points at its stone.
  ideaMarker: { marginTop: -0.5 },
});
