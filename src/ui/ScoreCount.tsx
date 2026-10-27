import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { Breakdown, countPlan, CountPlan, CountStep, Region } from '../go/count';
import { Color, GameState, stoneOf } from '../go/rules';
import { Button, IconButton } from './Buttons';
import { countLegend, points } from './copy';
import type { CountedPoints } from './board/territory';
import { CAPTURE_LAND_MS } from './board/motion';
import { t } from './i18n';
import { play } from './sound';
import { Stone } from './Stone';
import { STAGGER_MS } from './stoneMotion';
import { colors, fonts, territoryTint } from './theme';
import { useSame } from './useSame';

/** Unhurried enough for a child to follow each part of the count. */
const COUNT_LEAD_MS = 1000;
const COUNT_STEP_MS = 2800;
/** At the dead stones' step: how long they show ringed before they fly off, and the pause after they land. */
const DEAD_RINGED_MS = 1000;
const DEAD_LANDED_MS = 900;

export interface Stepper {
  /** Steps shown so far, 0 to `total`. */
  index: number;
  total: number;
  playing: boolean;
  back: () => void;
  next: () => void;
  toggle: () => void;
  skip: () => void;
}

/**
 * After Count, shows the score step by step: each player's stones, then all their territory,
 * with the running totals for the player cards, then komi, in a step of its own as the board doesn't
 * hold it, and last all counted points together, so the count ends on
 * who holds more of the board, with every part of the score added. Before all that, any
 * dead stones, both colours in one step: ringed, then flying off to their captors' cards, and the
 * count moves on only once they have landed, so the flight never overlaps the next step. It waits for the
 * player to step through, plays on its own after Play, and can be stepped back or skipped;
 * `onEnd` runs when it reaches the result.
 * `gameKey` names the game shown: opening another game that has already ended does not count it.
 * With `preview`, while the dead stones are marked, the score shown is the count of the marked position.
 */
export function useScoreCount({
  game,
  animate,
  preview,
  onEnd,
  gameKey = '',
}: {
  game: GameState;
  animate: boolean;
  preview: boolean;
  onEnd: () => void;
  gameKey?: string;
}) {
  const plan = useMemo(() => (game.phase === 'over' && game.result?.reason === 'score' ? countPlan(game) : null), [game]);
  // Decided while rendering, so the result card never shows for a frame before the count starts.
  // Only a game counted on screen animates; one that ends any other way shows its result at once.
  const [seen, setSeen] = useState({ phase: game.phase, key: gameKey });
  const [run, setRun] = useState<{ plan: CountPlan; shown: number; playing: boolean } | null>(null);
  if (game.phase !== seen.phase || gameKey !== seen.key) {
    setSeen({ phase: game.phase, key: gameKey });
    setRun(gameKey === seen.key && seen.phase !== 'over' && plan && animate ? { plan, shown: 0, playing: false } : null);
  }
  const running = run && run.plan === plan ? run : null;
  // The board's steps, then komi, then the areas.
  const onBoard = useMemo(() => plan?.steps.filter((s) => s.kind !== 'komi') ?? [], [plan]);
  const komi = plan?.steps.find((s) => s.kind === 'komi');
  const n = onBoard.length;
  const komiStep = komi ? n + 1 : 0;
  const areasStep = plan ? n + (komi ? 2 : 1) : 0;
  const lastStep = areasStep;
  // The dead stones are the first step, when there are any.
  const deadStep = onBoard[0]?.kind === 'dead' ? 1 : 0;
  const deadCount = deadStep ? onBoard[0].points.length : 0;
  const shown = running ? running.shown : Infinity;
  const done = !plan || shown > lastStep;

  // At the dead stones' step: ringed (no `lift`), then flying, then landed; `queued` moves on as soon as they land.
  const [lift, setLift] = useState<{ phase: 'flying' | 'landed'; queued: boolean } | null>(null);
  const move = useCallback(
    (to: (shown: number) => number, playing?: boolean) => {
      setLift(null);
      setRun((r) => (r ? { ...r, shown: Math.max(0, Math.min(lastStep + 1, to(r.shown))), playing: playing ?? r.playing } : r));
    },
    [lastStep],
  );
  const playing = running?.playing ?? false;
  const atDead = !!running && deadStep > 0 && shown === deadStep;
  const deadPhase = atDead ? (lift?.phase ?? 'ringed') : null;
  const queued = !!lift?.queued;
  useEffect(() => {
    if (!playing || done || atDead) return;
    const timer = setTimeout(() => move((i) => i + 1), shown === 0 ? COUNT_LEAD_MS : COUNT_STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, shown, done, atDead, move]);
  useEffect(() => {
    if (!deadPhase) return;
    const flyOff = () => {
      play(deadCount >= 4 ? 'captureMany' : 'capture');
      setLift((l) => ({ phase: 'flying', queued: !!l?.queued }));
    };
    const [after, then] =
      deadPhase === 'ringed'
        ? [DEAD_RINGED_MS, flyOff]
        : deadPhase === 'flying'
          ? [CAPTURE_LAND_MS + STAGGER_MS * (deadCount - 1), () => setLift((l) => ({ phase: 'landed', queued: !!l?.queued }))]
          : queued || playing
            ? [queued ? 0 : DEAD_LANDED_MS, () => move((i) => i + 1)]
            : [null, null];
    if (after === null || !then) return;
    const timer = setTimeout(then, after);
    return () => clearTimeout(timer);
  }, [deadPhase, queued, playing, deadCount, move]);
  /** ▶▶ at the dead stones' step sends them off at once, and moves on once they have landed. */
  const next = () => {
    if (!deadPhase || deadPhase === 'landed') return move((i) => i + 1, false);
    setRun((r) => (r ? { ...r, playing: false } : r));
    if (deadPhase === 'ringed') play(deadCount >= 4 ? 'captureMany' : 'capture');
    setLift({ phase: 'flying', queued: true });
  };

  // A tick for every step forward, and the result tune once the count reaches the end.
  const end = useRef(onEnd);
  end.current = onEnd;
  const last = useRef(shown);
  useEffect(() => {
    const before = last.current;
    last.current = shown;
    if (!running || shown <= before) return;
    if (shown <= lastStep) play('tick');
    else end.current();
  }, [running, shown, lastStep]);

  const steps = useMemo(() => [...onBoard.slice(0, shown), ...(komi && shown >= komiStep ? [komi] : [])], [onBoard, komi, shown, komiStep]);
  const totals = { black: 0, white: 0 };
  const breakdown: Record<Color, Breakdown> = {
    black: { stones: 0, territory: 0, shared: 0, komi: 0 },
    white: { stones: 0, territory: 0, shared: 0, komi: 0 },
  };
  for (const s of steps) {
    if (s.kind === 'dead' || !s.color) continue;
    for (const c of s.kind === 'shared' ? (['black', 'white'] as const) : [s.color]) {
      totals[c] += s.add;
      breakdown[c][s.kind] += s.add;
    }
  }
  const previewed = useMemo(() => (preview && game.phase === 'scoring' ? countPlan(game) : null), [preview, game]);
  const current = !plan || shown === areasStep || shown > lastStep ? undefined : steps[steps.length - 1];
  // The board is redrawn only when what it shows changes, so these keep their identity between renders.
  const regions = useMemo(() => (plan ? territoryOf(steps) : null), [plan, steps]);
  const counted = useMemo<CountedPoints | null>(
    () =>
      plan
        ? {
            regions: steps.flatMap((s) =>
              (s.kind === 'stones' || s.kind === 'territory') && s.color
                ? [{ owner: stoneOf(s.color) as Region['owner'], points: s.points }]
                : [],
            ),
            shared: steps.flatMap((s) => (s.kind === 'shared' ? s.points : [])),
          }
        : null,
    [plan, steps],
  );
  const shownStep = useSame(
    current
      ? {
          step: shown,
          kind: current.kind,
          color: current.kind === 'shared' ? null : current.color,
          points: current.points,
          label: stepLabel(current),
        }
      : null,
  );
  const stepper: Stepper | null =
    running && !done
      ? {
          index: shown,
          total: lastStep,
          playing,
          back: () => move((i) => i - 1, false),
          next,
          toggle: () => move((i) => i, !playing),
          skip: () => move(() => Infinity, false),
        }
      : null;
  const toLastStep = useCallback(() => setRun(plan ? { plan, shown: lastStep, playing: false } : null), [plan, lastStep]);
  return {
    /** The score shown and how it is made up: the count so far once counted, or the preview while marking. */
    score: plan ? { totals, breakdown } : previewed ? { totals: previewed.total, breakdown: previewed.breakdown } : null,
    /** What the line beside the board says while the count is stepped through. */
    status: stepper ? countStatus(stepper) : null,
    done,
    /** Each player's whole area in their colour: the count's last step, after komi. */
    areas: !!plan && shown === areasStep,
    /** Stones, territory and shared points counted so far, also kept on the result. */
    points: counted,
    /** Whether the dead stones have come off the board: from when they fly off, in their own step. */
    takenOff: !!plan && (shown > deadStep || (atDead && deadPhase !== 'ringed')),
    /** Whether this game was counted on screen, rather than opened already over. */
    onScreen: !!running,
    /** From the result, back to the count's last step, paused, to step back through it from there. */
    toLastStep: plan && done ? toLastStep : null,
    stepper,
    /** Territory as far as the count has got; null when there is no count. */
    regions,
    current: shownStep,
  };
}

const total = (b: Breakdown) => b.stones + b.territory + b.shared + b.komi;

/** The parts of a score: stones, territory and any shared points and komi. */
function scoreParts(b: Breakdown): string[] {
  const first = b.stones === 1 ? t('1 stone') : t('{n} stones', { n: b.stones });
  return [
    first,
    t('{n} territory', { n: b.territory }),
    ...(b.shared ? [t('{n} shared', { n: points(b.shared) })] : []),
    ...(b.komi ? [t('{n} komi', { n: points(b.komi) })] : []),
  ];
}

/** How a score is made up, e.g. "10 stones + 26 territory + 1½ shared + 7½ komi = 45". */
function scoreText(b: Breakdown): string {
  return `${scoreParts(b).join(' + ')} = ${points(total(b))}`;
}

function countStatus(s: Stepper): string {
  return s.index === 0 ? t('Tap Watch, or ▶▶ to go step by step.') : t('Counting · step {i} of {n}', { i: s.index, n: s.total });
}

/**
 * `toMarking`, when given, is where stepping back before the first step leads: marking the dead stones again.
 * `guard` wraps every button, so a double tap on the button these replace doesn't reach them.
 */
export function CountControls({
  stepper,
  toMarking,
  guard,
}: {
  stepper: Stepper;
  toMarking?: () => void;
  guard: (fn: () => void) => () => void;
}) {
  const atStart = stepper.index === 0;
  // The status line names Watch and ▶▶ until the count starts: they hop one after the other.
  const nudge = atStart && !stepper.playing;
  return (
    <>
      <IconButton
        label={atStart && toMarking ? t('Back to marking the stones') : t('Previous step')}
        icon="play-back"
        testID="count-back"
        size={52}
        disabled={atStart && !toMarking}
        onPress={guard(atStart && toMarking ? toMarking : stepper.back)}
      />
      <Button
        label={stepper.playing ? t('Pause') : t('Watch')}
        icon={stepper.playing ? 'pause' : 'play'}
        testID="count-play"
        flex
        nudge={nudge ? 900 : null}
        onPress={guard(stepper.toggle)}
      />
      <IconButton
        label={t('Next step')}
        icon="play-forward"
        testID="count-next"
        size={52}
        nudge={nudge ? 1050 : null}
        onPress={guard(stepper.next)}
      />
      <Button label={t('Skip')} icon="play-skip-forward" testID="count-skip" onPress={guard(stepper.skip)} />
    </>
  );
}

/** What the cross and the squares on the board mean while it counts, and the komi. */
/** `dead`: stones are taken off in this count, and the cross that marks them still shows. */
export function CountLegend({ komi, dead, shared, testID }: { komi: number; dead: boolean; shared: boolean; testID: string }) {
  const items = [
    ...(dead ? [countLegend.dead()] : []),
    countLegend.point('black'),
    countLegend.point('white'),
    ...(shared ? [countLegend.shared()] : []),
    ...(komi ? [countLegend.komi(komi)] : []),
  ];
  return (
    <View style={styles.legend} testID={testID} accessible accessibilityLabel={items.join(', ')}>
      {dead && <DeadItem />}
      {(['black', 'white'] as const).map((c) => (
        <View key={c} style={styles.legendItem}>
          <View style={[styles.legendSquare, { backgroundColor: territoryTint(c) }]} />
          <Text style={styles.legendText}>{countLegend.point(c)}</Text>
        </View>
      ))}
      {shared && (
        <View style={styles.legendItem}>
          <View style={[styles.legendSquare, styles.sharedSquare]}>
            <View style={{ flex: 1, backgroundColor: territoryTint('black') }} />
            <View style={{ flex: 1, backgroundColor: territoryTint('white') }} />
          </View>
          <Text style={styles.legendText}>{countLegend.shared()}</Text>
        </View>
      )}
      {komi ? <Text style={styles.legendText}>{countLegend.komi(komi)}</Text> : null}
    </View>
  );
}

/** The legend's cross, as stones marked dead carry it on the board. */
function DeadItem() {
  return (
    <View style={styles.legendItem}>
      <Svg width={12} height={12}>
        <Line x1={2} y1={2} x2={10} y2={10} stroke={colors.danger} strokeWidth={2.5} strokeLinecap="round" />
        <Line x1={2} y1={10} x2={10} y2={2} stroke={colors.danger} strokeWidth={2.5} strokeLinecap="round" />
      </Svg>
      <Text style={styles.legendText}>{countLegend.dead()}</Text>
    </View>
  );
}

/** While the dead stones are marked: what the ✕ and the ? on the stones mean, for the marks the board shows. */
export function MarkingLegend({ dead, unsure, testID }: { dead: boolean; unsure: boolean; testID: string }) {
  const items = [...(dead ? [countLegend.dead()] : []), ...(unsure ? [countLegend.unsure()] : [])];
  return (
    <View style={styles.legend} testID={testID} accessible accessibilityLabel={items.join(', ')}>
      {dead && <DeadItem />}
      {unsure && (
        <View style={styles.legendItem}>
          <Text style={styles.legendQuestion}>?</Text>
          <Text style={styles.legendText}>{countLegend.unsure()}</Text>
        </View>
      )}
    </View>
  );
}

export interface ScoreRow {
  color: Color;
  name: string;
  score: Breakdown;
}

/**
 * Each player's score in columns, stones, territory, shared points when there are any, komi and
 * total, so the parts line up under each other.
 * `adding` is the part the count is adding now, picked out on that player's row.
 */
export function ScoreTable({
  rows,
  adding,
  suffix = '',
  compact,
  you = null,
}: {
  rows: readonly ScoreRow[];
  adding?: { color: Color | null; kind: string } | null;
  /** Added to the test IDs, telling the two ends apart face to face. */
  suffix?: string;
  /** Smaller, for the short band at each end face to face. */
  compact?: boolean;
  /** Face to face, the player at this end: their row says "you". */
  you?: Color | null;
}) {
  const shared = rows.some((r) => r.score.shared);
  const columns = shared ? (['stones', 'territory', 'shared', 'komi'] as const) : (['stones', 'territory', 'komi'] as const);
  const heads = [t('Stones'), t('Territory'), ...(shared ? [t('Shared')] : []), t('Komi'), t('Total')];
  return (
    <View style={styles.table} testID={`score-breakdown${suffix}`}>
      <View style={styles.tableRow}>
        <View style={styles.tableName} />
        {heads.map((h) => (
          <Text
            key={h}
            style={[styles.cell, compact && styles.cellCompact, styles.head, compact && styles.headCompact]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {h}
          </Text>
        ))}
      </View>
      {rows.map(({ color, name, score }) => (
        <View
          key={color}
          style={styles.tableRow}
          testID={`breakdown-${color}${suffix}`}
          accessible
          accessibilityLabel={`${name}: ${scoreText(score)}`}
        >
          <View style={styles.tableName}>
            <View style={[styles.tableStone, compact && styles.tableStoneCompact]}>
              <Stone color={color} size={compact ? 13 : 16} />
            </View>
            <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={1}>
              {name}
              {color === you && <Text style={styles.you}>{` ${t('you')}`}</Text>}
            </Text>
          </View>
          {columns.map((kind) => (
            <Text
              key={kind}
              style={[
                styles.cell,
                compact && styles.cellCompact,
                (adding?.color === color || adding?.kind === 'shared') && adding.kind === kind && styles.adding,
              ]}
            >
              {kind === 'komi' && !score.komi ? '–' : points(score[kind])}
            </Text>
          ))}
          <Text style={[styles.cell, compact && styles.cellCompact, styles.total]}>{points(total(score))}</Text>
        </View>
      ))}
    </View>
  );
}

/** The territory regions among the counted steps, as regions for the board. */
function territoryOf(steps: readonly CountStep[]): Region[] {
  return steps.flatMap((s) =>
    s.kind === 'territory' && s.color ? [{ owner: stoneOf(s.color) as Region['owner'], points: s.points }] : [],
  );
}

function stepLabel(s: CountStep): string {
  if (s.kind === 'komi') return t('+{n} komi', { n: points(s.add) });
  if (s.kind === 'dead') return t('{n} can’t escape: taken off', { n: s.points.length });
  if (s.kind === 'stones') return s.add === 1 ? t('+1 stone') : t('+{n} stones', { n: s.add });
  if (s.kind === 'shared')
    return s.points.length === 1
      ? t('1 shared point: +½ each')
      : t('{n} shared points: +{half} each', { n: s.points.length, half: points(s.add) });
  return t('+{n} territory', { n: s.add });
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 2,
    flexWrap: 'wrap',
    minHeight: 18,
    marginBottom: 2,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSquare: { width: 10, height: 10, borderWidth: 1, borderColor: colors.textMuted },
  sharedSquare: { flexDirection: 'row', overflow: 'hidden' },
  legendQuestion: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  legendText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textMuted },
  table: { alignSelf: 'stretch', paddingHorizontal: 4 },
  tableStone: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  tableStoneCompact: { width: 15, height: 15 },
  tableRow: { flexDirection: 'row', alignItems: 'center' },
  tableName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  name: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: colors.text },
  nameCompact: { fontSize: 12, lineHeight: 15 },
  you: { fontFamily: fonts.semibold, color: colors.accent },
  cell: {
    width: 52,
    textAlign: 'right',
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  // Face to face the band also holds the count's status and legend: header and both rows must fit beside them.
  cellCompact: { width: 44, fontSize: 12, lineHeight: 15 },
  head: { fontSize: 11, lineHeight: 14 },
  headCompact: { fontSize: 10, lineHeight: 12 },
  adding: { color: colors.accent, fontFamily: fonts.bold },
  total: { fontFamily: fonts.heavy, color: colors.text },
});
