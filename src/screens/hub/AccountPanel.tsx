import { useState } from 'react';
import { Keyboard, Text, TextInput, View } from 'react-native';
import { onTestLab } from '../../../modules/test-lab';
import { ApiError, type Account } from '../../net/api';
import { api } from '../../net/client';
import { Button } from '../../ui/Buttons';
import { t } from '../../ui/i18n';
import { colors } from '../../ui/theme';
import { styles } from './styles';

/**
 * Email sign-in, which links this phone's profile and games to an account for family play. `hint`
 * says what signing in is for; null leaves it to the page around the panel.
 */
export function AccountPanel({
  account,
  title = t('Play online (optional)'),
  hint = t('Sign in with your email to play online. You can always play offline.'),
}: {
  account: Account | null;
  title?: string;
  hint?: string | null;
}) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  if (!api) return null;
  // The keyboard's own key does what the button under the field does, when the button could.
  const canSend = !busy && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canVerify = !busy && code.trim().length >= 6;
  const run = async (action: 'send' | 'verify' | 'out') => {
    if (busy || !api) return;
    Keyboard.dismiss();
    setBusy(true);
    setProblem('');
    try {
      if (action === 'out') await api.signOut();
      else if (action === 'verify' && sentTo) await api.verifyCode(sentTo, code);
      else {
        const address = email.trim().toLowerCase();
        // Mail to the crawler's addresses bounces, and too many bounces stop the project's sign-in mail.
        if (onTestLab) throw new Error('No sign-in codes from Test Lab');
        await api.sendCode(address);
        setSentTo(address);
        setCode('');
      }
    } catch (e) {
      setProblem(
        e instanceof ApiError && e.code === 'network'
          ? t('Could not connect. Check your connection and try again. You can always play offline.')
          : action === 'verify'
            ? t('That code is invalid or expired. Try again or request a new code.')
            : action === 'out'
              ? t('Could not sign out. Please try again.')
              : t('Could not send a code. Check your email address and try again in a minute.'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      {account ? (
        <>
          <Text style={styles.hint} testID="signed-in">
            {t('Signed in as {email}', { email: account.email })}
          </Text>
          <Text style={styles.hint}>{t('Your profile and games stay on this phone when you sign out.')}</Text>
          <Button label={t('Sign out')} testID="sign-out" disabled={busy} onPress={() => void run('out')} />
        </>
      ) : (
        <>
          {hint && <Text style={styles.hint}>{hint}</Text>}
          {sentTo ? (
            <>
              <Text style={styles.hint}>{t('Enter the code sent to {email}.', { email: sentTo })}</Text>
              <TextInput
                style={styles.nameInput}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                returnKeyType="done"
                onSubmitEditing={() => canVerify && void run('verify')}
                maxLength={10}
                accessibilityLabel={t('Email code')}
                testID="sign-in-code"
              />
              <Button
                label={t('Sign in')}
                variant="primary"
                testID="verify-code"
                disabled={!canVerify}
                onPress={() => void run('verify')}
              />
              <Button label={t('Send a new code')} testID="resend-code" disabled={busy} onPress={() => void run('send')} />
              <Button
                label={t('Use a different email')}
                testID="change-email"
                disabled={busy}
                onPress={() => {
                  setSentTo(null);
                  setProblem('');
                }}
              />
            </>
          ) : (
            <>
              <TextInput
                style={styles.nameInput}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="send"
                onSubmitEditing={() => canSend && void run('send')}
                placeholder={t('Email address')}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t('Email address')}
                testID="sign-in-email"
              />
              <Button label={t('Send a code')} variant="primary" testID="send-code" disabled={!canSend} onPress={() => void run('send')} />
            </>
          )}
        </>
      )}
      {!!problem && (
        <Text style={styles.error} testID="sign-in-error">
          {problem}
        </Text>
      )}
    </View>
  );
}
