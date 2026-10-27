import { useState } from 'react';
import { Image, Keyboard, Text, TextInput, View } from 'react-native';
import { Level } from '../../go/rating';
import type { LobbyProblem } from '../../net/lobby';
import { AboutLine } from '../../ui/AboutLine';
import { Button, IconButton } from '../../ui/Buttons';
import { LANGUAGES, t } from '../../ui/i18n';
import { markStartPending } from '../../ui/prefs';
import { colors } from '../../ui/theme';
import { lobbyProblemText } from '../onlineText';
import { AccountPanel } from './AccountPanel';
import { MenuRow } from '../../ui/Menu';
import { AvatarChoice, FamilyCodeInput, LevelChoice } from './parts';
import { styles } from './styles';
import type { HubProps } from './types';
import welcomeArt from '../../../assets/welcome-cats.png';

type WelcomeProps = Pick<HubProps, 'account' | 'canJoin' | 'family' | 'language' | 'online' | 'onWelcome'> & {
  /** Android's back steps back through the welcome; the welcome sets what it does. */
  back: { current: () => void };
};

/**
 * `choose`: new here, or played before. `about`: name, level and animal, for a new player.
 * `family`: the optional sign-in and family code that end a new player's welcome.
 * `returning`: sign-in, after which the family's profile comes back and the welcome ends.
 */
type Step = 'choose' | 'about' | 'family' | 'returning';

/**
 * The first start. A new player answers the profile's questions and may then sign in for the family;
 * a returning player signs in and gets their profile back. Without a family server there is nothing to
 * sign in to, so the welcome is only the questions. Nothing is saved until the welcome ends.
 */
export function Welcome(p: WelcomeProps) {
  const first: Step = p.canJoin ? 'choose' : 'about';
  const [step, setStep] = useState<Step>(first);
  const [name, setName] = useState('');
  const [nameProblem, setNameProblem] = useState<LobbyProblem | null>(null);
  // Nothing is chosen for the player: they pick the level that describes them.
  const [level, setLevel] = useState<Level | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinProblem, setJoinProblem] = useState<LobbyProblem | null>(null);
  const signedIn = !!p.account;
  const joining = signedIn && !p.family.member;

  const previous: Step | null =
    step === 'family' ? 'about' : step === 'about' && first === 'choose' ? 'choose' : step === 'returning' ? 'choose' : null;
  p.back.current = () => previous && setStep(previous);

  const start = async () => {
    if (!level || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    const problem = await p.onWelcome(name.trim(), level, avatar, joining ? code.trim() || undefined : undefined);
    setBusy(false);
    if (problem === 'nameTaken') {
      setNameProblem(problem);
      setStep('about');
    } else setJoinProblem(problem);
  };

  const title = step === 'returning' ? t('Welcome back') : t('Welcome!');
  return (
    <>
      <View style={styles.setupHeader}>
        {previous ? (
          <IconButton label={t('Back')} icon="arrow-back" testID="welcome-back" size={44} onPress={() => setStep(previous)} />
        ) : (
          <View style={styles.stoneIcon}>
            <View style={styles.blackStoneHalf} />
            <View style={styles.whiteStoneHalf} />
          </View>
        )}
        <Text style={styles.appTitle}>{title}</Text>
      </View>

      {step === 'choose' && (
        <>
          <Text style={styles.hint}>{t('Play Go against the bot, face to face, or online with others on their own phones.')}</Text>
          <MenuRow
            primary
            icon="sparkles-outline"
            title={t('I’m new here')}
            detail={t('Tell the game your name and how much you have played')}
            testID="welcome-new"
            onPress={() => setStep('about')}
          />
          <MenuRow
            icon="log-in-outline"
            title={t('I have played before')}
            detail={t('Sign in with your email to get your profile back')}
            testID="welcome-returning"
            onPress={() => {
              markStartPending();
              setStep('returning');
            }}
          />
          <View style={styles.welcomeArt}>
            <Image source={welcomeArt} style={styles.welcomeCats} resizeMode="contain" accessible={false} />
            <Text style={styles.welcomeName} accessibilityRole="header">
              Shoutan <Text style={styles.welcomeHanzi}>手談</Text>
            </Text>
            <Text style={styles.welcomeMotto}>{t('A conversation in stones')}</Text>
          </View>
        </>
      )}

      {step === 'about' && (
        <>
          <Text style={styles.hint}>{t('Before your first game, tell the game your name and how much you have played.')}</Text>
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
              testID="welcome-name"
            />
            {nameProblem && (
              <Text style={styles.error} testID="welcome-name-error">
                {lobbyProblemText(nameProblem)}
              </Text>
            )}
          </View>
          <View style={styles.section}>
            <Text style={styles.label}>{t('Your level')}</Text>
            <LevelChoice level={level} onChoose={setLevel} testID="welcome-level" />
            <Text style={styles.hint}>{t('It sets your starting rank; after that, your rank follows your games.')}</Text>
          </View>
          <View style={styles.section}>
            <Text style={styles.label}>{t('Your animal')}</Text>
            <AvatarChoice avatar={avatar} onChoose={setAvatar} testID="welcome-avatar" />
            <Text style={styles.hint}>{t('Shown beside your name.')}</Text>
          </View>
          {p.canJoin ? (
            <Button
              label={t('Next')}
              variant="primary"
              testID="welcome-next"
              disabled={!name.trim() || !level}
              onPress={() => {
                Keyboard.dismiss();
                setStep('family');
              }}
            />
          ) : (
            <StartButton disabled={!name.trim() || !level || busy} onPress={() => void start()} />
          )}
        </>
      )}

      {step === 'family' && (
        <>
          <Text style={styles.hint}>{t('Online you play others on their own phones. You can also sign in later from your profile.')}</Text>
          <AccountPanel account={p.account} title={t('Play online (optional)')} hint={null} />
          {joining && (
            <View style={styles.section}>
              <Text style={styles.label}>{t('Online play')}</Text>
              <Text style={styles.hint}>{t('Enter the family code once to find each other and play online.')}</Text>
              <FamilyCodeInput
                value={code}
                onChange={(text) => {
                  setCode(text);
                  setJoinProblem(null);
                }}
                testID="welcome-family-code"
              />
              {joinProblem && (
                <Text style={styles.error} testID="welcome-error">
                  {lobbyProblemText(joinProblem)}
                </Text>
              )}
            </View>
          )}
          <StartButton disabled={busy} onPress={() => void start()} />
        </>
      )}

      {step === 'returning' && (
        <>
          <Text style={styles.hint}>{t('Sign in with the email you used before. Your name, animal and rating come back.')}</Text>
          <AccountPanel account={p.account} title={t('Sign in')} hint={null} />
          {signedIn && <Returning online={p.online} onNew={() => setStep('about')} />}
        </>
      )}

      {/* Wherever the welcome begins, the language can be changed first. */}
      {step === 'choose' || (step === 'about' && first === 'about') ? (
        <>
          <LanguageRow language={p.language} />
          <AboutLine testID="welcome-about" />
        </>
      ) : null}
    </>
  );
}

/** The four languages in one line, so a new player can switch before reading on. */
function LanguageRow({ language }: { language: HubProps['language'] }) {
  return (
    <View style={styles.languageRow}>
      {LANGUAGES.map((l, i) => (
        <Text key={l.value} style={styles.languageItem}>
          {i > 0 ? ' · ' : ''}
          <Text
            style={l.value === language.value ? styles.languageCurrent : null}
            onPress={() => language.set(l.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: l.value === language.value }}
            testID={`welcome-lang-${l.value}`}
          >
            {l.label}
          </Text>
        </Text>
      ))}
    </View>
  );
}

function StartButton(p: { disabled: boolean; onPress: () => void }) {
  return <Button label={t('Start playing')} variant="primary" testID="welcome-done" disabled={p.disabled} onPress={p.onPress} />;
}

/**
 * Signed in on the way back: the family's profile is looked up, and once found the welcome ends on
 * its own (`usePlayer` takes the family's name). An account with no profile in the family starts as new.
 */
function Returning(p: { online: HubProps['online']; onNew: () => void }) {
  const lobby = p.online?.state;
  if (lobby?.me === null)
    return (
      <View style={styles.section} testID="welcome-no-profile">
        <Text style={styles.hint}>{t('This email has no profile yet. Tell the game about yourself, then enter the family code.')}</Text>
        <Button label={t('Next')} variant="primary" testID="welcome-continue" onPress={p.onNew} />
      </View>
    );
  if (lobby && !lobby.online)
    return (
      <View style={styles.section}>
        <Text style={styles.error} testID="welcome-offline">
          {t('Could not connect. Check your connection and try again. You can always play offline.')}
        </Text>
        <Button label={t('Try again')} testID="welcome-retry" onPress={() => p.online?.onRefresh()} />
      </View>
    );
  return (
    <Text style={styles.hint} testID="welcome-looking">
      {t('Looking for your profile…')}
    </Text>
  );
}
