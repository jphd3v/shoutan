import { useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { isNewer } from '../../go/finished';
import { Level } from '../../go/rating';
import type { LobbyProblem } from '../../net/lobby';
import { Button, IconButton } from '../../ui/Buttons';
import { finishedText, levelText, newerGameText } from '../../ui/copy';
import { t } from '../../ui/i18n';
import { colors } from '../../ui/theme';
import { lobbyProblemText } from '../onlineText';
import type { HubProps } from './types';
import { AccountPanel } from './AccountPanel';
import { styles } from './styles';
import { TextLink } from '../../ui/Menu';
import { AvatarChoice, FamilyCodeInput, LevelChoice } from './parts';

type ProfileProps = Pick<
  HubProps,
  | 'account'
  | 'canJoin'
  | 'family'
  | 'kept'
  | 'nameOf'
  | 'onAvatar'
  | 'onOpenGame'
  | 'onJoin'
  | 'onName'
  | 'onRestartRating'
  | 'profile'
  | 'rank'
>;

/** The player's profile: name, animal, level, email sign-in, the family and their finished games. */
export function ProfileView(p: ProfileProps & { onBack: () => void; leave: { current: () => void } }) {
  // Once given, the name can be changed but never emptied: an empty name would ask for the welcome again.
  const [name, setName] = useState(p.profile.name ?? '');
  const [nameProblem, setNameProblem] = useState<LobbyProblem | null>(null);
  const [restart, setRestart] = useState<Level | null | 'choosing'>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinProblem, setJoinProblem] = useState<LobbyProblem | null>(null);
  const familyProblem = joinProblem ?? (p.family.member ? null : p.family.problem);

  const done = async () => {
    const wanted = name.trim();
    if (wanted && wanted !== p.profile.name) {
      const refused = await p.onName(wanted);
      setNameProblem(refused);
      if (refused) return;
    }
    p.onBack();
  };
  p.leave.current = () => void done();
  const join = async () => {
    Keyboard.dismiss();
    setBusy(true);
    setJoinProblem(await p.onJoin(code.trim()));
    setBusy(false);
  };

  return (
    <>
      <View style={styles.setupHeader}>
        <IconButton label={t('Back')} icon="arrow-back" testID="hub-back" size={44} onPress={() => void done()} />
        <Text style={styles.setupTitle}>{t('Profile')}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>{t('Your name')}</Text>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={(text) => {
            setName(text);
            setNameProblem(null);
          }}
          placeholder={t('Your name')}
          placeholderTextColor={colors.textMuted}
          maxLength={24}
          accessibilityLabel={t('Player name')}
          testID="hub-player-name"
        />
        {nameProblem && (
          <Text style={styles.error} testID="hub-name-error">
            {lobbyProblemText(nameProblem)}
          </Text>
        )}
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>{t('Your level')}</Text>
        <Text style={styles.levelValue} testID="hub-level-value">
          {levelText(p.profile.level)}
          {p.rank ? ` · ${p.rank}` : ''}
        </Text>
        <Text style={styles.hint}>{t('Set when you started. Your rank follows your games.')}</Text>
        {restart === null ? (
          <TextLink label={t('Start my rating again')} icon="refresh" testID="hub-restart-rating" onPress={() => setRestart('choosing')} />
        ) : (
          <View style={styles.confirm} testID="hub-restart-confirm">
            <LevelChoice level={restart === 'choosing' ? null : restart} onChoose={setRestart} testID="hub-restart-level" />
            <Text style={styles.confirmText}>{t('Your rating starts again from this level. Your finished games are kept.')}</Text>
            <View style={styles.confirmRow}>
              <Button label={t('Cancel')} testID="hub-restart-cancel" flex onPress={() => setRestart(null)} />
              <Button
                label={t('Start again')}
                variant="primary"
                testID="hub-restart-yes"
                flex
                disabled={restart === 'choosing'}
                onPress={() => {
                  if (restart === 'choosing') return;
                  p.onRestartRating(restart);
                  setRestart(null);
                }}
              />
            </View>
          </View>
        )}
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>{t('Your animal')}</Text>
        <AvatarChoice avatar={p.profile.avatar ?? null} onChoose={(a) => void p.onAvatar(a).then(setNameProblem)} testID="hub-avatar" />
        <Text style={styles.hint}>{t('Shown beside your name.')}</Text>
      </View>
      {p.canJoin && <AccountPanel account={p.account} title={t('Play online (optional)')} />}
      {p.account && (
        <View style={styles.section} testID="hub-family">
          <Text style={styles.label}>{t('Online play')}</Text>
          {p.family.member ? (
            <Text style={styles.hint}>{t('You can play online with others on their own devices.')}</Text>
          ) : (
            <>
              <Text style={styles.hint}>{t('Enter the family code once to find each other and play online.')}</Text>
              <FamilyCodeInput
                value={code}
                onChange={(text) => {
                  setCode(text);
                  setJoinProblem(null);
                }}
                testID="hub-family-code"
              />
              {familyProblem && (
                <Text style={styles.error} testID="hub-family-error">
                  {lobbyProblemText(familyProblem)}
                </Text>
              )}
              <Button label={t('Join')} testID="hub-join" disabled={!code.trim() || busy} onPress={() => void join()} />
            </>
          )}
        </View>
      )}
      <View style={styles.section} testID="hub-history">
        <Text style={styles.label}>{t('Your games')}</Text>
        <Text style={styles.hint} testID="hub-history-hint">
          {p.account && p.family.member
            ? t('Saved on this device and in your account.')
            : p.canJoin
              ? t('Saved on this device. Sign in and enter the family code to keep them in your account.')
              : t('Saved on this device.')}
        </Text>
        {p.kept.length === 0 ? (
          <Text style={styles.hint}>{t('Finished games show here.')}</Text>
        ) : (
          p.kept.map(({ game, uploaded, refused }) => {
            const rating = isNewer(game) ? undefined : game.meta.rating;
            const text = isNewer(game)
              ? newerGameText(game.endedAt)
              : finishedText(game, p.nameOf, rating ? rating.after - rating.before : null);
            const row = (
              <>
                <View style={styles.gameText}>
                  <Text style={styles.gameTitle} numberOfLines={1}>
                    {text.title}
                  </Text>
                  <Text style={styles.hint}>{text.result}</Text>
                  <Text style={styles.hint}>{text.details}</Text>
                  {p.account && p.family.member && !uploaded && !refused && (
                    <Text style={styles.hint} testID={`unsent-${game.id}`}>
                      {t('Not saved online yet')}
                    </Text>
                  )}
                </View>
              </>
            );
            return isNewer(game) ? (
              <View key={game.id} style={styles.gameRow} testID={`history-${game.id}`}>
                {row}
              </View>
            ) : (
              <Pressable
                key={game.id}
                style={styles.gameRow}
                testID={`history-${game.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${text.title}. ${text.result}. ${text.details}`}
                onPress={() => p.onOpenGame(game.id)}
              >
                {row}
              </Pressable>
            );
          })
        )}
      </View>
      <Button label={t('Done')} variant="primary" testID="hub-profile-done" onPress={() => void done()} />
    </>
  );
}
