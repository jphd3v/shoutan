import { Component, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Buttons';
import { colors, fonts } from './theme';
import { t } from './i18n';

interface Props {
  children: ReactNode;
  onError: (error: unknown, componentStack: string) => void;
}

/** Shows a calm message instead of a blank screen when drawing the app fails, and reports the error. */
export class ErrorBoundary extends Component<Props, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    this.props.onError(error, info.componentStack ?? '');
  }

  render() {
    if (!this.state.failed)
      return (
        <View style={styles.fill} key={this.state.attempt}>
          {this.props.children}
        </View>
      );
    return (
      <View style={styles.screen} testID="error-screen">
        <Text style={styles.title}>{t('Something went wrong')}</Text>
        <Text style={styles.body}>{t('The problem was saved and will be sent automatically, so it can be fixed.')}</Text>
        <Button
          label={t('Try again')}
          icon="refresh"
          variant="primary"
          testID="error-retry"
          onPress={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 28, gap: 16 },
  title: { fontFamily: fonts.heavy, fontSize: 24, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: colors.textMuted },
});
