import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, ReactNode, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Checkbox, Segmented } from './Buttons';
import { Dimmed } from './Dimmed';
import { Language, LANGUAGES, t } from './i18n';
import { MenuFooter, MenuRow } from './Menu';
import { Sheet } from './Sheet';
import { colors, fonts, radius } from './theme';
import type { Choices } from './usePrefs';

/** The player's choices: the board and sound, play, the hints with the Coach, and language. */
export interface SettingsProps {
  choices: Choices;
}

interface Props extends SettingsProps {
  visible: boolean;
  onClose: () => void;
  /** The game on screen in a few words, as the main menu's Continue shows it. */
  summary?: string;
  /** New game: the main menu's setup for this kind of game, starting from its settings (Play online for an online game). */
  onSetup?: () => void;
  /** What resigning would mean (e.g. "Resign? Black will lose this game."), or null when there is no game to resign. */
  resignWarning: string | null;
  onResign: () => void;
  onHub: () => void;
  onSettings: () => void;
  onRules: () => void;
  onFeedback: () => void;
}

/**
 * The game's ☰ menu, a small main menu: from what keeps the game going down to what ends or leaves it, then
 * Rules, Feedback and Settings. Only Resign loses anything, so only it asks first; the main menu keeps the game.
 */
export function OptionsSheet(p: Props) {
  const [confirmResign, setConfirmResign] = useState(false);

  useEffect(() => {
    if (!p.visible) setConfirmResign(false);
  }, [p.visible]);

  // While Resign asks, everything else in the sheet steps back, and a tap on it cancels.
  const dim = (node: ReactNode, testID?: string) => (
    <Dimmed when={confirmResign} testID={testID} onTap={() => setConfirmResign(false)}>
      {node}
    </Dimmed>
  );

  return (
    <Sheet visible={p.visible} onClose={p.onClose} from="top" testID="options-sheet">
      <View style={styles.body}>
        {dim(
          <MenuRow
            primary
            icon="play"
            title={t('Keep playing')}
            detail={p.summary}
            chevron={false}
            testID="options-resume"
            onPress={p.onClose}
          />,
          'options-dimmed',
        )}

        {/* The setup asks before it replaces an unfinished game. */}
        {p.onSetup &&
          dim(
            <MenuRow
              icon="refresh"
              title={t('New game')}
              detail={t('Change the settings and start again')}
              testID="new-game"
              onPress={p.onSetup}
            />,
          )}

        {p.resignWarning !== null &&
          (confirmResign ? (
            <View style={styles.confirm} testID="resign-confirm">
              <Text style={styles.confirmText}>{p.resignWarning}</Text>
              <View style={styles.confirmRow}>
                <Button label={t('Keep playing')} testID="resign-cancel" flex onPress={() => setConfirmResign(false)} />
                <Button label={t('Resign')} icon="flag" variant="primary" testID="resign-yes" flex onPress={p.onResign} />
              </View>
            </View>
          ) : (
            dim(
              <MenuRow
                icon="flag-outline"
                title={t('Resign')}
                detail={t('End this game as a loss')}
                chevron={false}
                testID="resign"
                onPress={() => setConfirmResign(true)}
              />,
            )
          ))}

        {dim(
          <MenuRow
            icon="home-outline"
            title={t('Main menu')}
            detail={t('This game waits there under Continue')}
            testID="options-hub"
            onPress={p.onHub}
          />,
        )}

        {dim(
          <View style={styles.footer}>
            <MenuFooter
              onRules={p.onRules}
              onFeedback={p.onFeedback}
              onSettings={p.onSettings}
              testIDs={{ rules: 'help', feedback: 'feedback', settings: 'options-settings' }}
            />
          </View>,
        )}
      </View>
    </Sheet>
  );
}

/** A titled card of the Settings page. */
function Section({ icon, title, children }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; children: ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={18} color={colors.accent} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

/** The main menu's Settings page as a sheet, opened from the game's Settings button or its ☰ menu. */
export function GuideSheet(p: SettingsProps & { visible: boolean; onClose: () => void; online: boolean }) {
  return (
    <Sheet visible={p.visible} title={t('Settings')} onClose={p.onClose} testID="guide-sheet">
      <View style={styles.body}>
        <OptionsSettings choices={p.choices} quick online={p.online} />
      </View>
    </Sheet>
  );
}

/**
 * The Settings page: the board and sound, how a game runs, the hints from the lightest to the Coach,
 * and the language. `quick` gives the hints' switches the game sheet's test ids.
 */
/** `online`: the game on screen is an online one, where the Coach stays off whatever the player chose. */
export function OptionsSettings(p: SettingsProps & { quick?: boolean; online?: boolean }) {
  const { choices } = p;
  const id = (inOptions: string, inSheet: string) => (p.quick ? `quick-${inSheet}` : inOptions);
  return (
    <>
      <Section icon="options-outline" title={t('Board and sound')}>
        <Checkbox label={t('Coordinates')} checked={choices.coordinates.value} testID="coordinates" onChange={choices.coordinates.set} />
        <Checkbox label={t('Star points')} checked={choices.starPoints.value} testID="star-points" onChange={choices.starPoints.set} />
        <Checkbox label={t('Sound')} checked={choices.sound.value} testID="sound" onChange={choices.sound.set} />
        <Checkbox label={t('Vibration')} checked={choices.vibration.value} testID="vibration" onChange={choices.vibration.set} />
      </Section>

      <Section icon="play-outline" title={t('Play')}>
        <Checkbox
          label={t('Tap twice to place a stone')}
          checked={choices.confirmMoves.value}
          testID="confirm-moves"
          onChange={choices.confirmMoves.set}
        />
        <Checkbox
          label={t('Count the score step by step')}
          checked={choices.countSteps.value}
          testID="count-steps"
          onChange={choices.countSteps.set}
        />
        <Checkbox label={t('Show Go ranks')} checked={choices.showRanks.value} testID="show-ranks" onChange={choices.showRanks.set} />
      </Section>

      <Section icon="bulb-outline" title={t('Hints')}>
        <Checkbox
          label={t('Liberties')}
          checked={choices.showLiberties.value}
          testID={id('show-liberties', 'liberties')}
          onChange={choices.showLiberties.set}
        />
        <Checkbox
          label={t('Groups')}
          checked={choices.showGroups.value}
          testID={id('show-groups', 'groups')}
          onChange={choices.showGroups.set}
        />
        <Checkbox
          label={t('Territory')}
          checked={choices.showTerritory.value}
          testID={id('show-territory', 'territory')}
          onChange={choices.showTerritory.set}
        />
        <Checkbox
          label={t('Likely areas')}
          checked={choices.likelyAreas.value}
          testID={id('likely-areas', 'likely')}
          onChange={choices.likelyAreas.set}
        />
        <Checkbox
          label={t('Score estimate')}
          checked={choices.scoreEstimate.value}
          testID={id('score-estimate', 'estimate')}
          onChange={choices.scoreEstimate.set}
        />
        <Checkbox
          label={t('Show the Coach')}
          checked={choices.teaching.value && !p.online}
          disabled={p.online}
          testID={id('opt-teaching', 'teaching')}
          onChange={choices.teaching.set}
        />
        <Text style={styles.note}>
          {p.online
            ? t('Off in online games, where you play without its help.')
            : t(
                'The bot’s strongest moves, what your last move cost and stones in danger. Games played with it don’t count for your rating.',
              )}
        </Text>
      </Section>

      <Section icon="language-outline" title={t('Language')}>
        <Checkbox
          label={t('Use the phone’s language')}
          checked={choices.language.followPhone}
          testID="opt-lang-phone"
          onChange={(on) => choices.language.set(on ? null : choices.language.value)}
        />
        <Segmented<Language>
          value={choices.language.value}
          onChange={choices.language.set}
          options={LANGUAGES.map((l) => ({ value: l.value, label: l.label, testID: `opt-lang-${l.value}` }))}
        />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  footer: { marginTop: 6 },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.accent,
    letterSpacing: 0.4,
  },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.textMuted },
  confirm: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  confirmText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 10 },
});
