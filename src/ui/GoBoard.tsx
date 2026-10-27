import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { CountStep, Region } from '../go/count';
import { libertiesOf, Liberty } from '../go/guide';
import type { StatusGroup } from '../go/netHints';
import { BLACK, chainAt, Color, COLUMN_LETTERS, EMPTY, GameState, pointName, WHITE } from '../go/rules';
import { useReduceMotion } from './motion';
import { Stone } from './Stone';
import { Language, t } from './i18n';
import { colors, fonts } from './theme';
import type { GuideNote } from './useGuide';
import { Callout, CALLOUT_H } from './board/Callout';
import { BOARD_EDGE, boardGeometry, starPoints } from './board/geometry';
import { GHOST } from './board/ghost';
import { GroupOutlines } from './board/GroupOutlines';
import { GroupTubes } from './board/GroupTubes';
import { LibertyRings } from './board/LibertyRings';
import { Moving, useStoneMotion } from './board/motion';
import { AreaFills, CountedPoints, ProjectedSquares, TerritorySquares } from './board/territory';
import { useBoardTouch } from './board/useBoardTouch';

export { BOARD_EDGE } from './board/geometry';

interface Props {
  game: GameState;
  /** Board width in dp. */
  width: number;
  /** Territory shown as a small square on each point; each region fades in when it first appears. */
  territory: readonly Region[] | null;
  /** Who the score estimate gives each point to: empty points it gives a player, outside `territory`, get a faint square. */
  projected?: readonly number[] | null;
  /** The score step being counted: a label says what it adds. */
  counting?: { step: number; kind: CountStep['kind']; color: Color | null; points: readonly number[]; label: string } | null;
  /** The count's last step: each player's stones and territory filled in their colour under the stones, in place of the squares. */
  areas?: boolean;
  /** Squares for every stone, territory point and shared point counted so far. */
  counted?: CountedPoints | null;
  /** Shows A–T and 1–19 around the grid. */
  coordinates?: boolean;
  /** Draws the star points, the traditional fixed dots on the grid. */
  starPoints?: boolean;
  /** Where on the page each colour's captured stones fly to, usually its player card. */
  captureTarget?: (captor: Color) => { x: number; y: number } | null;
  /** A tentative move awaiting a confirming tap. */
  preview: number | null;
  /** A point shown the way an aimed stone is (translucent stone, guide lines, its liberties), e.g. the idea a player tapped. */
  spotlight?: number | null;
  /**
   * While the finger is down, a translucent stone of this colour follows it with guide lines, and
   * lifting reports the point under the finger. Null when it is not the player's turn.
   */
  aimColor?: Color | null;
  /**
   * Aim from the moment the finger lands (moves need a confirming tap). Otherwise aiming starts only
   * once the finger slides to another point or rests, so a quick tap places without a flash of lines.
   */
  aimAtOnce?: boolean;
  /** Holding a stone shows its group's liberties, and an aimed or previewed stone shows the liberties it would have. */
  showLiberties?: boolean;
  /** Joins neighbouring stones of one colour into one shape, so each group reads at a glance. */
  groups?: boolean;
  /** A Guide note over the stones the last move affected. */
  note?: GuideNote | null;
  /**
   * A face-to-face game, the players across the phone from each other: the players who see the Guide note, each
   * getting their own copy that floats to their end, below the board for Black and upside down above it for White.
   * Null for a game with one player at the phone: the note floats up.
   */
  noteTo?: readonly Color[] | null;
  /** Suggested moves for the player to move, drawn as ghost stones; the label is for screen readers. */
  ghosts?: readonly { point: number; label: string }[];
  /** Hollow liberty rings; shared points split into each colour's half. */
  liberties?: readonly Liberty[];
  /** The Coach's chains, outlined as lost, urgent or weak. */
  outlines?: readonly StatusGroup[];
  /** This change is a redo: its stones slide back in the way undo took them off, instead of being placed. */
  redone?: boolean;
  /** The language the point labels are read in: the board is memoised, so a change must redraw it. */
  language: Language;
  onTap: (point: number) => void;
}

function describe(game: GameState, p: number, ghost?: string, area?: Region['owner']): string {
  const s = game.board[p];
  const stone = s === BLACK ? t('black stone') : s === WHITE ? t('white stone') : t('empty');
  const areaText = s === EMPTY && area ? (area === BLACK ? t(', Black area') : t(', White area')) : '';
  const deadText = game.dead.has(p) ? t(', marked dead') : '';
  const unsureText = game.phase === 'scoring' && game.unsure?.has(p) ? t(', not sure') : '';
  return `${pointName(game.size, p)}, ${stone}${deadText}${unsureText}${areaText}${ghost ? t(', suggested: {idea}', { idea: ghost }) : ''}`;
}

export const GoBoard = memo(function GoBoard({
  game,
  width,
  territory,
  projected = null,
  counting = null,
  counted = null,
  areas = false,
  coordinates = false,
  starPoints: showStarPoints = false,
  captureTarget,
  preview,
  spotlight = null,
  aimColor = null,
  aimAtOnce = false,
  showLiberties = false,
  groups: showGroups = false,
  note = null,
  noteTo = null,
  ghosts = [],
  liberties = [],
  outlines = [],
  redone = false,
  onTap,
}: Props) {
  const n = game.size;
  // The playing face is square; the darker edge below it gives the board thickness.
  const face = width;
  const height = width + BOARD_EDGE;
  const { cell, origin, span, at } = boardGeometry(width, n, coordinates);
  const boardRadius = Math.min(16, Math.max(8, Math.round(origin * 0.72)));
  const lineWidth = n > 13 ? 0.8 : 1.1;
  const coordSize = Math.max(8, Math.min(13, cell * 0.34));
  // Groups leaves a gap between neighbouring stones, so the bars joining them show.
  const stoneSize = cell * (showGroups ? 0.82 : 0.96);
  const lastMove = game.moves[game.moves.length - 1];
  const last = lastMove?.kind === 'play' ? lastMove.point : -1;

  const reduceMotion = useReduceMotion();

  const { boardRef, boardPage, responder, aim, held } = useBoardTouch({
    game,
    origin,
    cell,
    aimColor,
    aimAtOnce,
    showLiberties,
    onTap,
  });
  const { live, slide, arriving } = useStoneMotion({ game, still: reduceMotion, redone, captureTarget, boardPage, at, cell });

  const aiming = aim !== null;
  // The one translucent stone on the board: under the finger, else the preview, else the spotlight.
  const shown = aiming ? aim : (preview ?? (spotlight !== null && game.board[spotlight] === EMPTY ? spotlight : null));
  // A tapped idea stays its ghost stone, with a solid ring, rather than turning into a plain preview.
  const spotGhost = !aiming && preview === null && shown !== null && ghosts.some((g) => g.point === shown) ? shown : null;

  // Face to face the notes go to both ends; White sits at the top, reading the board the other way up.
  const facing = noteTo !== null;
  const areaAt = new Map((territory ?? []).flatMap((r) => r.points.map((p) => [p, r.owner] as const)));
  // A dead stone carries one mark: the cross while it is marked, then its captor's square once that area is counted.
  const marking = game.phase === 'scoring';
  const stones = [];
  const marks = [];
  for (let p = 0; p < n * n; p++) {
    const x = at(p % n);
    const y = at(Math.floor(p / n));
    const s = game.board[p];
    const dead = game.dead.has(p);
    // A guess the players should check: a "?" instead of a cross; the faded stone still says it would come off.
    const unsure = marking && !!game.unsure?.has(p);
    if (s !== EMPTY && !arriving.has(p)) {
      const placing = live?.placed.get(p);
      stones.push(
        <View
          key={`${p}-${s}`}
          pointerEvents="none"
          style={[styles.slot, { left: x - cell / 2, top: y - cell / 2, width: cell, height: cell }]}
        >
          <Stone
            color={s === BLACK ? 'black' : 'white'}
            size={stoneSize}
            drop={placing && placing.home === undefined ? placing.delay : undefined}
            slide={placing && placing.home !== undefined ? slide(p, placing.home, placing.delay) : undefined}
            faded={dead}
            marked={p === last && !counted}
          />
        </View>,
      );
    } else if (s === EMPTY && p === shown && p !== spotGhost) {
      stones.push(
        <View
          key={`preview-${p}`}
          pointerEvents="none"
          style={[styles.slot, { left: x - cell / 2, top: y - cell / 2, width: cell, height: cell }]}
        >
          <Stone color={aiming && aimColor ? aimColor : game.toPlay} size={stoneSize} faded />
        </View>,
      );
    }
    if (unsure) {
      const question = (key: string, qx: number, size: number, rotation = 0) => (
        <SvgText
          key={key}
          x={qx}
          y={y + size * 0.35}
          rotation={rotation}
          origin={`${qx}, ${y}`}
          textAnchor="middle"
          fontSize={size}
          fontFamily={fonts.heavy}
          fill={colors.accent}
          stroke="#1A1306"
          strokeWidth={cell * 0.025}
        >
          ?
        </SvgText>
      );
      // Face to face, a smaller "?" for each player, the second turned for the one across the table.
      if (facing)
        marks.push(question(`unsure-${p}`, x - cell * 0.13, cell * 0.4), question(`unsure-up-${p}`, x + cell * 0.13, cell * 0.4, 180));
      else marks.push(question(`unsure-${p}`, x, cell * 0.52));
    } else if (dead && (marking || !areaAt.has(p))) {
      const d = cell * 0.18;
      marks.push(
        <Line
          key={`x1-${p}`}
          x1={x - d}
          y1={y - d}
          x2={x + d}
          y2={y + d}
          stroke={colors.danger}
          strokeWidth={cell * 0.08}
          strokeLinecap="round"
        />,
        <Line
          key={`x2-${p}`}
          x1={x - d}
          y1={y + d}
          x2={x + d}
          y2={y - d}
          stroke={colors.danger}
          strokeWidth={cell * 0.08}
          strokeLinecap="round"
        />,
      );
    }
  }

  const ghostAt = new Map(
    ghosts.filter((g) => game.board[g.point] === EMPTY && (g.point !== shown || g.point === spotGhost)).map((g) => [g.point, g.label]),
  );
  // With two ideas, each ghost carries a faint number matching its sentence above the board.
  const numbered = ghosts.length > 1;
  [...ghostAt.keys()].forEach((p) => {
    const x = at(p % n);
    const y = at(Math.floor(p / n));
    stones.push(
      <View
        key={`ghost-${p}`}
        pointerEvents="none"
        style={[styles.slot, { opacity: GHOST.opacity[game.toPlay] }, { left: x - cell / 2, top: y - cell / 2, width: cell, height: cell }]}
      >
        <Stone color={game.toPlay} size={stoneSize} />
      </View>,
    );
    const spot = p === spotGhost;
    const ring = { cx: x, cy: y, r: cell * 0.5, strokeDasharray: spot ? undefined : '4 3', fill: 'none' };
    // Keyed by the look, so a ring that turns solid remounts instead of keeping its dashes.
    const look = spot ? 'solid' : 'dashed';
    marks.push(
      // A dark edge under the green ring keeps it readable on the wood.
      <Circle key={`ghost-edge-${p}-${look}`} {...ring} stroke={colors.noteEdge} strokeWidth={spot ? 4.4 : 3.4} />,
      <Circle key={`ghost-ring-${p}-${look}`} {...ring} stroke={colors.idea} strokeWidth={spot ? 3 : 2} />,
    );
    if (numbered) {
      marks.push(
        <SvgText
          key={`ghost-n-${p}`}
          // Face to face, White sits across the table and reads the number the other way up.
          rotation={facing && game.toPlay === 'white' ? 180 : 0}
          origin={`${x}, ${y}`}
          x={x}
          y={y + cell * 0.16}
          textAnchor="middle"
          fontSize={cell * 0.44}
          fontFamily={fonts.heavy}
          fill={GHOST.number[game.toPlay]}
          fillOpacity={0.96}
        >
          {ghosts.findIndex((g) => g.point === p) + 1}
        </SvgText>,
      );
    }
  });

  const dot = (key: string, p: number, r: number, fill: string, opacity = 1) => (
    <Circle key={key} cx={at(p % n)} cy={at(Math.floor(p / n))} r={r} fill={fill} fillOpacity={opacity} stroke="#1A1306" strokeWidth={1} />
  );
  marks.push(
    <LibertyRings
      key="liberties"
      liberties={liberties.filter((l) => game.board[l.point] === EMPTY && !ghostAt.has(l.point))}
      n={n}
      cell={cell}
      origin={origin}
    />,
  );
  const heldLiberties = held !== null && game.board[held] !== EMPTY ? libertiesOf(game, held) : null;
  if (heldLiberties) for (const q of heldLiberties) if (!ghostAt.has(q)) marks.push(dot(`lib-${q}`, q, cell * 0.17, colors.accent));

  const ghostKey = [...ghostAt.keys()].join();
  let callout = null;
  if (counting) {
    for (const p of counting.points) {
      if (counting.kind !== 'dead' || game.board[p] === EMPTY) continue;
      marks.push(
        <Circle
          key={`count-${p}`}
          cx={at(p % n)}
          cy={at(Math.floor(p / n))}
          r={cell * 0.26}
          // In contrast to the stone, as one step can ring stones of both colours.
          stroke={game.board[p] === BLACK ? '#FFFFFF' : '#1A1A1A'}
          strokeWidth={Math.max(1.5, cell * 0.07)}
          fill="none"
        />,
      );
    }
    const pts = counting.points;
    const cx = pts.length ? pts.reduce((sum, p) => sum + at(p % n), 0) / pts.length : width / 2;
    const middle = pts.length ? pts.reduce((sum, p) => sum + at(Math.floor(p / n)), 0) / pts.length : face / 2;
    // Face to face, each player gets a copy the right way up, one each side of the counted points. Near an edge
    // the pair moves inward together: each copy kept inside on its own would slide onto the other.
    const pair = CALLOUT_H * 1.05;
    const cy = noteTo ? Math.max(pair, Math.min(width - pair, middle)) : middle;
    callout = (noteTo ?? [null]).map((reader) => (
      <Callout
        key={`callout-${counting.step}-${reader ?? 'all'}`}
        counting
        label={counting.label}
        color={counting.color}
        x={cx}
        y={reader === null ? cy : reader === 'black' ? cy + CALLOUT_H * 0.55 : cy - CALLOUT_H * 0.55}
        flip={reader === 'white'}
        still={reduceMotion}
        bounds={width}
      />
    ));
  } else if (heldLiberties && held !== null) {
    const k = heldLiberties.length;
    const group = chainAt(game.board, n, held).stones;
    const cx = group.reduce((sum, p) => sum + at(p % n), 0) / group.length;
    // Above the group and its liberty dots, so the label covers neither.
    const top = Math.min(...[...group, ...heldLiberties].map((p) => at(Math.floor(p / n))));
    callout = (
      <Callout
        key={`held-${held}`}
        label={k === 1 ? t('1 liberty: atari!') : t('{n} liberties', { n: k })}
        color={null}
        x={cx}
        y={top - cell}
        still={reduceMotion}
        bounds={width}
      />
    );
  } else if (note) {
    const cx = note.points.reduce((sum, p) => sum + at(p % n), 0) / note.points.length;
    const top = Math.min(...note.points.map((p) => at(Math.floor(p / n))));
    const bottom = Math.max(...note.points.map((p) => at(Math.floor(p / n))));
    // Face to face, each copy starts on its reader's side of the stones, so the two never overlap.
    callout = (noteTo ?? [null]).map((reader) => (
      <Callout
        key={`note-${note.id}-${reader ?? 'all'}`}
        label={note.label}
        color={null}
        x={cx}
        y={reader === 'black' ? bottom + cell * 1.5 : top - cell * 1.5}
        rise={reader === 'black' ? 'down' : 'up'}
        flip={reader === 'white'}
        still={reduceMotion}
        bounds={width}
      />
    ));
  }

  // Guide lines along the aimed stone's row and column, kept while the move waits for its confirming tap.
  const lined = shown !== null && game.board[shown] === EMPTY ? shown : null;
  if (lined !== null) {
    const ax = at(lined % n);
    const ay = at(Math.floor(lined / n));
    const guide = { stroke: colors.accent, strokeWidth: 1.5, strokeOpacity: 0.7 };
    marks.unshift(
      <Line key="aim-h" x1={origin} x2={origin + span} y1={ay} y2={ay} {...guide} />,
      <Line key="aim-v" y1={origin} y2={origin + span} x1={ax} x2={ax} {...guide} />,
    );
  }

  live?.moving.forEach(({ p, s: stone, delay, exit }) => {
    const x = at(p % n);
    const y = at(Math.floor(p / n));
    const color = stone === BLACK ? 'black' : 'white';
    stones.push(
      <View
        key={`moving-${live.id}-${exit.kind}-${p}`}
        pointerEvents="none"
        style={[styles.slot, { left: x - cell / 2, top: y - cell / 2, width: cell, height: cell }]}
      >
        {exit.kind === 'lift' ? (
          <Stone color={color} size={stoneSize} slide={slide(p, exit.home, delay, true)} marked={exit.marked} />
        ) : (
          // The card offsets are from the board's corner; the stone flies from its own point.
          <Moving
            color={color}
            size={stoneSize}
            exit={exit.kind === 'fly' ? { ...exit, dx: exit.dx - x, dy: exit.dy - y } : exit}
            delay={delay}
          />
        )}
      </View>,
    );
  });

  const coords = [];
  for (let i = 0; coordinates && i < n; i++) {
    const letter = COLUMN_LETTERS[i];
    const number = String(n - i);
    const common = { fill: colors.coord, fontSize: coordSize, fontFamily: fonts.semibold, textAnchor: 'middle' as const };
    // Labels sit in the outer band, clear of stones on the edge lines.
    const band = cell * 0.43;
    const dy = coordSize * 0.35;
    coords.push(
      <SvgText key={`t${i}`} x={at(i)} y={band + dy} {...common}>
        {letter}
      </SvgText>,
      <SvgText key={`b${i}`} x={at(i)} y={face - band + dy} {...common}>
        {letter}
      </SvgText>,
      <SvgText key={`l${i}`} x={band} y={at(i) + dy} {...common}>
        {number}
      </SvgText>,
      <SvgText key={`r${i}`} x={width - band} y={at(i) + dy} {...common}>
        {number}
      </SvgText>,
    );
  }

  return (
    <View ref={boardRef} {...responder} style={[styles.board, { width, height }]} testID="board">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.woodLight} />
            <Stop offset="1" stopColor={colors.woodDark} />
          </LinearGradient>
          <LinearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.18" />
            <Stop offset="0.12" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} rx={boardRadius} fill={colors.woodEdge} />
        <Rect x={0} y={0} width={width} height={face} rx={boardRadius} fill="url(#wood)" />
        <Rect x={0} y={0} width={width} height={face} rx={boardRadius} fill="url(#sheen)" />
        <Rect x={origin} y={origin} width={span} height={span} fill="none" stroke={colors.grid} strokeWidth={lineWidth * 1.8} />
        {Array.from({ length: n - 2 }, (_, k) => (
          <Line key={`h${k}`} x1={origin} x2={origin + span} y1={at(k + 1)} y2={at(k + 1)} stroke={colors.grid} strokeWidth={lineWidth} />
        ))}
        {Array.from({ length: n - 2 }, (_, k) => (
          <Line key={`v${k}`} y1={origin} y2={origin + span} x1={at(k + 1)} x2={at(k + 1)} stroke={colors.grid} strokeWidth={lineWidth} />
        ))}
        {(showStarPoints ? starPoints(n).filter((p) => !ghostAt.has(p)) : []).map((p) => (
          <Circle key={`s${p}`} cx={at(p % n)} cy={at(Math.floor(p / n))} r={Math.max(2.5, cell * 0.09)} fill={colors.grid} />
        ))}
        {coords}
      </Svg>
      {showGroups && <GroupTubes board={game.board} n={n} origin={origin} cell={cell} width={width} height={height} />}
      {stones}
      {areas && (
        <AreaFills game={game} territory={territory} still={reduceMotion} width={width} height={height} cell={cell} origin={origin} />
      )}
      <ProjectedSquares
        game={game}
        projected={projected}
        territory={territory}
        ghostKey={ghostKey}
        width={width}
        height={height}
        cell={cell}
        origin={origin}
      />
      <TerritorySquares
        game={game}
        territory={areas ? null : (counted?.regions ?? territory)}
        shared={areas ? undefined : counted?.shared}
        ghostKey={ghostKey}
        still={reduceMotion}
        width={width}
        height={height}
        cell={cell}
        origin={origin}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {marks}
      </Svg>
      {outlines.length > 0 && <GroupOutlines outlines={outlines} n={n} origin={origin} cell={cell} width={width} height={height} />}
      {callout}
      {/* The note floats above the board, outside its bounds, where screen readers can't reach it; announce it here. */}
      {note && (
        <View
          key={`note-a11y-${note.id}`}
          accessible
          accessibilityLabel={note.label}
          accessibilityLiveRegion="polite"
          testID="guide-note"
          pointerEvents="none"
          style={styles.noteAnnouncer}
        />
      )}
      {/* Invisible per-point nodes give screen readers (and UI tests) a target for every intersection. */}
      {Array.from({ length: n * n }, (_, p) => (
        <View
          key={p}
          pointerEvents="none"
          testID={`pt-${pointName(n, p)}`}
          accessible
          accessibilityRole="button"
          accessibilityLabel={describe(game, p, ghostAt.get(p), areaAt.get(p))}
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && onTap(p)}
          style={[styles.slot, { left: at(p % n) - cell / 2, top: at(Math.floor(p / n)) - cell / 2, width: cell, height: cell }]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  board: {
    borderRadius: 16,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    backgroundColor: colors.woodEdge,
  },
  slot: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  noteAnnouncer: { position: 'absolute', left: 0, top: 0, width: 24, height: 24 },
});
