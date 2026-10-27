#!/usr/bin/env node
// Files new player reports from Supabase as GitHub issues (`npm run sync-issues`).
// Reads reports with the go_reports login (GO_REPORTS_DATABASE_URL, or ~/.config/shoutan/reports.env)
// and writes issues with the maintainer's gh login (run locally) or the workflow's own credential (CI).
import pg from 'pg';
import { reportsDatabaseUrl } from './lib/config.mjs';
import { github, githubRepo, githubToken } from './lib/github.mjs';
import { syncReports } from './lib/issues.mjs';

const url = reportsDatabaseUrl();
const schemas = (process.env.GO_SCHEMAS ?? 'go').split(',').map((s) => s.trim());
for (const s of schemas) if (!['public', 'go'].includes(s)) throw new Error(`Unknown schema ${s}`);

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const filed = await syncReports({ db, gh: github({ token: githubToken(), repo: githubRepo() }), schemas, log: console.log });
  console.log(`Filed ${filed.length} report(s).`);
} finally {
  await db.end();
}
