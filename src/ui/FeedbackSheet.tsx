import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Segmented } from './Buttons';
import { Sheet } from './Sheet';
import { colors, fonts, radius } from './theme';
import { t } from './i18n';

type Kind = 'bug' | 'idea';
type Status = 'editing' | 'sending' | 'sent' | 'saved';

interface Props {
  visible: boolean;
  allowed: boolean;
  onSignIn: () => void;
  onClose: () => void;
  /** Queues the feedback and tries to send it; resolves true if it reached the server. */
  onSubmit: (kind: Kind, text: string) => Promise<boolean>;
  version: string;
}

export function FeedbackSheet({ visible, onClose, onSubmit, version, allowed, onSignIn }: Props) {
  const [kind, setKind] = useState<Kind>('bug');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('editing');

  const close = () => {
    if (status === 'sent' || status === 'saved') {
      setText('');
      setStatus('editing');
    }
    onClose();
  };

  const submit = async () => {
    setStatus('sending');
    setStatus((await onSubmit(kind, text.trim())) ? 'sent' : 'saved');
  };

  return (
    <Sheet visible={visible} title={t('Feedback')} onClose={close} testID="feedback-sheet">
      {!allowed ? (
        <View style={styles.body}>
          <Text style={styles.text}>{t('Sign in and enter the family code to send feedback.')}</Text>
          <Button label={t('Open profile')} testID="feedback-sign-in" onPress={onSignIn} />
        </View>
      ) : status === 'sent' || status === 'saved' ? (
        <View style={styles.body}>
          <Text style={styles.text} testID="feedback-done">
            {status === 'sent'
              ? t('Thank you! Your message was sent.')
              : t('Thank you! Your message is saved and will be sent when you’re online.')}
          </Text>
          <Button label={t('Close')} variant="primary" testID="feedback-close" onPress={close} />
        </View>
      ) : (
        <View style={styles.body}>
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'bug', label: t('Something’s wrong'), icon: 'bug-outline', testID: 'feedback-bug' },
              { value: 'idea', label: t('Idea'), icon: 'bulb-outline', testID: 'feedback-idea' },
            ]}
          />
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
            placeholder={kind === 'bug' ? t('What happened? What did you expect?') : t('What would make the game better?')}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            testID="feedback-text"
            accessibilityLabel={t('Your message')}
          />
          <Text style={styles.hint}>{t('The current game, board snapshot and app version ({version}) are sent along.', { version })}</Text>
          <Button
            label={status === 'sending' ? t('Sending…') : t('Send')}
            icon="send"
            variant="primary"
            testID="feedback-send"
            disabled={!text.trim() || status === 'sending'}
            onPress={() => void submit()}
          />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  text: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: colors.text },
  input: {
    minHeight: 120,
    maxHeight: 220,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },
});
