import { useEffect } from 'react';
import { AppState } from 'react-native';
import { api } from '../net/client';
import { reporter } from '../report/install';

/** Sends queued reports. Resolves false when offline or when the build has no backend. */
export async function sendReports(owner?: string): Promise<boolean> {
  if (!api || !owner) return false;
  try {
    const connection = api.forAccount(owner);
    if (!(await connection.me())) return false;
    return await reporter.flush((reports) => connection.sendReports(reports.map(({ owner: _owner, ...report }) => report)), owner);
  } catch {
    return false;
  }
}

/** Sends queued reports at start, whenever the app comes back to the screen, and every minute while some wait. */
export function useReportSending(owner?: string) {
  useEffect(() => {
    void sendReports(owner);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sendReports(owner);
    });
    const timer = setInterval(() => {
      if (reporter.queued().length && AppState.currentState === 'active') void sendReports(owner);
    }, 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [owner]);
}
