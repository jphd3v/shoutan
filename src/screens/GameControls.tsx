import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Color, GameState } from '../go/rules';
import type { Controls } from './shownGame';
import { Button, IconButton } from '../ui/Buttons';
import { t } from '../ui/i18n';
import { CountControls, useScoreCount } from '../ui/ScoreCount';

/** Count is nudged once the board's "Game over" card has gone, unless the status line asks about a ? group first. */
const NUDGE_COUNT_MS = 2400;

export type Guard = (fn: () => void) => () => void;

/**
 * The control row changes when the phase does (e.g. Count becomes New game) and when the count's
 * controls give way to New game, so a quick double tap could hit the new button. The guard ignores
 * taps just after a change; every phase-dependent button goes through it.
 */
export function useTapGuard(phase: GameState['phase'], stepping: boolean): Guard {
  const phaseSince = useRef(Date.now());
  useEffect(() => {
    phaseSince.current = Date.now();
  }, [phase, stepping]);
  return (fn) => () => {
    if (Date.now() - phaseSince.current > 500) fn();
  };
}

/** Against the bot and online, the row of buttons opens the Guide's switches from one button. */
function GuideButton({ onPress }: { onPress: () => void }) {
  return <IconButton label={t('Settings')} icon="options-outline" testID="guide" size={44} quiet onPress={onPress} />;
}

/** The row of buttons under the board, for every phase of the game on screen. */
export function GameControls({
  controls: c,
  count,
  facing,
  toMarking,
  guard,
  passOrWarn,
  onGuide,
  onOptions,
}: {
  controls: Controls;
  count: ReturnType<typeof useScoreCount>;
  facing: boolean;
  /** Where stepping back before the count's first step leads: marking the dead stones again. */
  toMarking?: () => void;
  guard: Guard;
  passOrWarn: (pass: () => void) => void;
  onGuide: () => void;
  /** Face to face only: there is no top-right menu, so the row carries it once play has stopped. */
  onOptions: () => void;
}) {
  return (
    <View style={[styles.controls, facing && styles.controlsFacing]}>
      {count.stepper ? (
        <CountControls stepper={count.stepper} guard={guard} toMarking={toMarking} />
      ) : c.stage === 'none' ? null : c.stage === 'waiting' ? (
        c.cancel && (
          <Button
            label={t('Cancel game')}
            icon="close"
            testID="cancel-game"
            flex
            disabled={!c.cancel.enabled}
            onPress={guard(c.cancel.run)}
          />
        )
      ) : c.stage === 'over' ? (
        <>
          {count.toLastStep && (
            <IconButton label={t('Previous step')} icon="play-back" testID="count-replay" size={52} onPress={guard(count.toLastStep)} />
          )}
          {c.again && (
            <Button
              label={c.again.label}
              icon={c.again.icon ?? 'refresh'}
              testID="rematch"
              variant="primary"
              flex
              onPress={guard(c.again.run)}
            />
          )}
        </>
      ) : c.stage === 'scoring' ? (
        <>
          <Button label={t('Keep playing')} icon="play" testID="resume" flex disabled={!c.resume.enabled} onPress={guard(c.resume.run)} />
          <Button
            label={c.accept.label}
            icon="checkmark"
            testID="accept"
            variant="primary"
            flex
            disabled={!c.accept.enabled}
            nudge={c.accept.nudge ? NUDGE_COUNT_MS : null}
            onPress={guard(c.accept.run)}
          />
        </>
      ) : (
        <>
          {c.undo && (
            <IconButton
              label={t('Undo')}
              icon="arrow-undo-outline"
              testID="undo"
              size={44}
              quiet
              disabled={!c.undo.enabled}
              onPress={guard(c.undo.run)}
            />
          )}
          {c.redo && (
            <IconButton
              label={t('Redo')}
              icon="arrow-redo-outline"
              testID="redo"
              size={44}
              quiet
              disabled={!c.redo.enabled}
              onPress={guard(c.redo.run)}
            />
          )}
          <GuideButton onPress={onGuide} />
          <Button
            label={t('Pass')}
            variant="quiet"
            testID="pass"
            disabled={!c.pass.enabled}
            onPress={guard(() => passOrWarn(c.pass.run))}
          />
        </>
      )}
      {facing && !count.stepper && <IconButton label={t('Options')} icon="menu" testID="options" size={44} quiet onPress={onOptions} />}
    </View>
  );
}

/**
 * Face to face, each player's own buttons beside their card: Pass only on the turn of the player at that end.
 * The Settings sheet is in the menu there, shared by both players, which leaves room for the card.
 */
export function FacingButtons({
  color,
  toPlay,
  controls: c,
  guard,
  passOrWarn,
  onOptions,
}: {
  color: Color;
  toPlay: Color;
  controls: Controls;
  guard: Guard;
  passOrWarn: (pass: () => void) => void;
  onOptions: () => void;
}) {
  const suffix = color === 'white' ? '-top' : '';
  return (
    <View style={styles.facingButtons}>
      {c.undo && (
        <IconButton
          label={t('Undo')}
          icon="arrow-undo-outline"
          testID={`undo${suffix}`}
          size={44}
          quiet
          disabled={!c.undo.enabled}
          onPress={guard(c.undo.run)}
        />
      )}
      {c.redo && (
        <IconButton
          label={t('Redo')}
          icon="arrow-redo-outline"
          testID={`redo${suffix}`}
          size={44}
          quiet
          disabled={!c.redo.enabled}
          onPress={guard(c.redo.run)}
        />
      )}
      <Button
        label={t('Pass')}
        variant="quiet"
        testID={`pass${suffix}`}
        disabled={toPlay !== color}
        onPress={guard(() => passOrWarn(c.pass.run))}
      />
      {/* Options would open upside down for White, so only Black's end has it; the gap keeps both rows alike. */}
      {color === 'black' ? (
        <IconButton label={t('Options')} icon="menu" testID="options" size={44} quiet onPress={onOptions} />
      ) : (
        <View style={styles.menuGap} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
  },
  controlsFacing: { justifyContent: 'center' },
  facingButtons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  menuGap: { width: 44, height: 44 },
});
