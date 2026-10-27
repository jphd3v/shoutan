import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useState } from 'react';
import { Pressable, StyleProp, Text, TextInput, TextStyle, View } from 'react-native';
import { Level, LEVELS } from '../../go/rating';
import { maxHandicap } from '../../go/rules';
import type { BoardSize, BotLevel } from '../../go/session';
import { AVATARS } from '../../ui/avatars';
import { IconButton } from '../../ui/Buttons';
import { handicapText, levelText } from '../../ui/copy';
import { t } from '../../ui/i18n';
import { colors } from '../../ui/theme';
import { styles } from './styles';

export const BOARD_HINT: Record<BoardSize, () => string> = {
  9: () => t('Short games. The best board to learn on.'),
  13: () => t('Longer games with more room.'),
  19: () => t('The full board. A game can take an hour.'),
};

/** What the bot is like, in three bands, so a player new to Go needs no ranks to choose. */
export const botHint = (level: BotLevel, human: boolean) =>
  human
    ? level <= 3
      ? t('Plays like a human beginner: natural moves, natural mistakes.')
      : level <= 5
        ? t('Plays like a human club player: solid, with human mistakes.')
        : t('Plays like a strong human player. A challenge.')
    : level === 1
      ? t('Plays loosely. A gentle opponent to learn the moves with.')
      : level <= 3
        ? t('Knows good shapes, but makes plenty of mistakes.')
        : level <= 5
          ? t('A steady opponent that punishes loose play.')
          : t('Plays real Go, like a strong club player. A challenge.');

/** The game settings behind a disclosure, in the setup against the bot or face to face and in the family lobby: the handicap. */
export function HandicapSettings(p: {
  size: BoardSize;
  handicap: number;
  onHandicap: (n: number) => void;
  prefix: 'hub' | 'online';
  valueTestID: string;
  titleStyle: StyleProp<TextStyle>;
  /** Shown under the stepper. */
  children?: ReactNode;
}) {
  // A handicap carried over from the last game shows, so it is not started by surprise.
  const [more, setMore] = useState(p.handicap > 0);
  const summary = handicapText(p.handicap);
  return (
    <>
      <Pressable
        testID="hub-game-settings"
        accessibilityRole="button"
        accessibilityState={{ expanded: more }}
        accessibilityLabel={`${t('Handicap')}, ${summary}`}
        onPress={() => setMore(!more)}
        style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
      >
        <View style={styles.disclosureText}>
          <Text style={p.titleStyle}>{t('Handicap')}</Text>
          <Text style={styles.hint}>{summary}</Text>
        </View>
        <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
      </Pressable>
      {more && (
        <View style={styles.more}>
          <Text style={styles.hint}>{t('Extra Black stones at the start, so players of different strength get a close game.')}</Text>
          <View style={styles.stepperRow}>
            <IconButton
              label={t('Fewer handicap stones')}
              icon="remove"
              testID={`${p.prefix}-handicap-less`}
              size={48}
              disabled={p.handicap === 0}
              onPress={() => p.onHandicap(p.handicap - 1)}
            />
            <Text style={styles.stepperText} testID={p.valueTestID}>
              {handicapText(p.handicap)}
            </Text>
            <IconButton
              label={t('More handicap stones')}
              icon="add"
              testID={`${p.prefix}-handicap-more`}
              size={48}
              disabled={p.handicap === maxHandicap(p.size)}
              onPress={() => p.onHandicap(p.handicap + 1)}
            />
          </View>
          {p.children}
        </View>
      )}
    </>
  );
}

/** The levels a player can describe themselves with, weakest first. */
export function LevelChoice(p: { level: Level | null; onChoose: (l: Level) => void; testID: string }) {
  return (
    <View style={styles.column} accessibilityRole="radiogroup">
      {LEVELS.map((l) => {
        const chosen = l === p.level;
        return (
          <Pressable
            key={l}
            testID={`${p.testID}-${l}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: chosen }}
            accessibilityLabel={levelText(l)}
            onPress={() => p.onChoose(l)}
            style={({ pressed }) => [styles.levelRow, chosen && styles.levelRowChosen, pressed && styles.pressed]}
          >
            <Ionicons name={chosen ? 'radio-button-on' : 'radio-button-off'} size={20} color={chosen ? colors.accent : colors.textMuted} />
            <Text style={[styles.levelText, chosen && styles.levelTextChosen]}>{levelText(l)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The animals a player can pick as avatar, and a choice of none: an empty disc on their card. */
export function AvatarChoice(p: { avatar: string | null; onChoose: (a: string | null) => void; testID: string }) {
  const option = (a: string | null, id: string) => {
    const chosen = a === p.avatar;
    return (
      <Pressable
        key={id}
        testID={`${p.testID}-${id}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: chosen }}
        accessibilityLabel={a ?? t('No animal')}
        onPress={() => p.onChoose(a)}
        style={({ pressed }) => [styles.avatarOption, chosen && styles.avatarOptionChosen, pressed && styles.pressed]}
      >
        {a ? <Text style={styles.avatarOptionText}>{a}</Text> : <View style={styles.avatarNone} />}
      </Pressable>
    );
  };
  return (
    <View style={styles.avatarGrid} accessibilityRole="radiogroup">
      {option(null, 'none')}
      {AVATARS.map((a, i) => option(a, String(i)))}
    </View>
  );
}

export function FamilyCodeInput(p: { value: string; onChange: (code: string) => void; testID: string }) {
  return (
    <TextInput
      style={styles.nameInput}
      value={p.value}
      onChangeText={p.onChange}
      placeholder={t('Family code')}
      placeholderTextColor={colors.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={t('Family code')}
      testID={p.testID}
    />
  );
}
