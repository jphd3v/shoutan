// The owner's settings live outside the repository, in ~/.config/shoutan/: infra.env (filled in by hand
// from infra/infra.env.example) and reports.env (written by npm run infra): GO_REPORTS_DATABASE_URL,
// the restricted go_reports database login.
// Variables already in the environment win, which is how CI and the tests supply them.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export const CONFIG_DIR = `${homedir()}/.config/shoutan`;
export const INFRA_ENV = process.env.GO_INFRA_ENV ?? `${CONFIG_DIR}/infra.env`;
export const REPORTS_ENV = `${CONFIG_DIR}/reports.env`;

export function loadReportsEnv() {
  if (existsSync(REPORTS_ENV)) {
    const before = { ...process.env };
    process.loadEnvFile(REPORTS_ENV);
    Object.assign(process.env, before);
  }
}

export function reportsDatabaseUrl() {
  loadReportsEnv();
  const url = process.env.GO_REPORTS_DATABASE_URL;
  if (!url) throw new Error(`Set GO_REPORTS_DATABASE_URL in ${REPORTS_ENV} (npm run infra)`);
  return url;
}
