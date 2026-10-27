/**
 * The app's single reporter, with handlers for uncaught errors and unhandled promise
 * rejections. Import this module first so errors during startup are caught too.
 */
import 'expo-sqlite/localStorage/install';
import { Platform } from 'react-native';
import { versionLabel } from '../config';
import { ReportContext, Reporter } from './reporter';

const KEY = 'go.reports';
let contextExtras: () => Record<string, unknown> = () => ({});

/** Adds details such as the player name and the current game to every report. */
export function setReportContext(extras: () => Record<string, unknown>) {
  contextExtras = extras;
}

export const reporter = new Reporter(
  { get: () => localStorage.getItem(KEY), set: (v) => localStorage.setItem(KEY, v) },
  (): ReportContext => {
    let extras: Record<string, unknown> = {};
    try {
      extras = contextExtras();
    } catch (e) {
      extras = { context_error: String(e) };
    }
    return { app_version: versionLabel, os: `${Platform.OS} ${Platform.Version}`, ...extras };
  },
);

const previous = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  reporter.captureError(error, isFatal ? 'crash' : 'error', 'global');
  previous(error, isFatal);
});

// React Native tracks unhandled rejections only in development builds (to show them on screen).
if (!__DEV__) {
  (
    globalThis as { HermesInternal?: { enablePromiseRejectionTracker?: (o: object) => void } }
  ).HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id: number, error: unknown) => reporter.captureError(error, 'error', 'unhandled promise'),
    onHandled: () => {},
  });
}
