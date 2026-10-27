import { useEffect, useMemo, useRef, useState } from 'react';
import { suggestionsFor } from '../go/guide';
import { encode, NetReading, read } from '../go/katago';
import { groupStatus, GroupStatus, moveCost, StatusGroup, strongestMoves, withOpponentToPlay } from '../go/netHints';
import { GameState, Move } from '../go/rules';
import { BOT_NET, evaluateNet } from '../../modules/go-net';
import { AdviceText, hintText, strongestLabel } from './copy';
import { useSame } from './useSame';

/** What the Coach shows for a position: outlined chains, ghost stones, the advice and which outlines the legend explains. */
export interface NetHints {
  outlines: readonly StatusGroup[];
  ghosts: readonly { point: number; label: string }[];
  advice: AdviceText | null;
  legend: readonly GroupStatus[];
}

const NONE: NetHints = { outlines: [], ghosts: [], advice: null, legend: [] };
const LEGEND_ORDER: readonly GroupStatus[] = ['urgent', 'lost', 'weak'];
/** Enough positions to price the player's last move: the one before it and the one after. */
const KEPT = 6;

const sameMove = (a: Move, b: Move) =>
  a.kind === b.kind && a.color === b.color && (a.kind !== 'play' || (b.kind === 'play' && a.point === b.point));
/** Whether `earlier` is `later` some moves back, in the same game. */
const leadsTo = (earlier: GameState, later: GameState) =>
  earlier.size === later.size && earlier.moves.length <= later.moves.length && earlier.moves.every((m, i) => sameMove(m, later.moves[i]));

const readFor = (game: GameState) => evaluateNet(BOT_NET, game.size, encode(game)).then((out) => read(game.size, out));

/**
 * The Coach for a game on this phone, from the bot's network. Every position is read while
 * `enabled`, so the player's last move can be priced; on the player's turn (`yourTurn`) the position is
 * read a second time with the opponent to move, to find stones that die unless the player answers.
 */
export function useNetHints(game: GameState, enabled: boolean, yourTurn: boolean): NetHints {
  const kept = useRef<{ game: GameState; reading: NetReading }[]>([]);
  const [found, setFound] = useState<{ game: GameState; mine: NetReading; theirs: NetReading | null } | null>(null);
  const on = enabled && game.phase === 'playing';

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const cachedMine = kept.current.find((k) => k.game === game)?.reading;
    Promise.all([cachedMine ?? readFor(game), yourTurn ? readFor(withOpponentToPlay(game)) : null])
      .then(([mine, theirs]) => {
        // Kept even when the game has moved on, as the bot's reply often comes first: the next turn prices the move from it.
        if (!cachedMine) {
          const line = kept.current.filter((k) => leadsTo(k.game, game) || leadsTo(game, k.game));
          kept.current = [...line, { game, reading: mine }].sort((a, b) => a.game.moves.length - b.game.moves.length).slice(-KEPT);
        }
        if (!cancelled) setFound({ game, mine, theirs });
      })
      .catch(() => {
        // No hints where the network can't answer; the game goes on.
      });
    return () => {
      cancelled = true;
    };
  }, [game, on, yourTurn]);

  const current = on && yourTurn && found?.game === game ? found : null;
  const hints = useMemo((): NetHints => {
    if (!current) return NONE;
    const outlines = groupStatus(game, current.mine, current.theirs);
    const moves = strongestMoves(game, current.mine);
    const at = (back: number) => kept.current.find((k) => k.game.moves.length === game.moves.length - back && leadsTo(k.game, game));
    const before = at(2);
    const after = at(1);
    const cost = before && after ? moveCost(before.game, before.reading, after.game, after.reading) : null;
    return {
      outlines,
      ghosts: moves.map((point, i) => ({ point, label: strongestLabel(i) })),
      advice: hintText(moves, cost, suggestionsFor(game)),
      legend: LEGEND_ORDER.filter((s) => outlines.some((o) => o.status === s)),
    };
  }, [current, game]);
  // The board redraws only when what it shows changes.
  const outlines = useSame(hints.outlines);
  const ghosts = useSame(hints.ghosts);
  return { ...hints, outlines, ghosts };
}
