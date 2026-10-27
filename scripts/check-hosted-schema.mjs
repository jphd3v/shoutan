#!/usr/bin/env node
// Refuses to continue when the hosted schema lacks a migration from this checkout, so
// an APK never ships ahead of the database it needs: `node scripts/check-hosted-schema.mjs`.
// Connects as the restricted go_reports login (GO_REPORTS_DATABASE_URL).
import { readdirSync } from 'node:fs';
import pg from 'pg';
import { reportsDatabaseUrl } from './lib/config.mjs';
import { HOSTED_SCHEMA as schema } from './lib/schema.mjs';

const url = reportsDatabaseUrl();

const wanted = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.replace(/\.sql$/, ''))
  .sort();
const db = new pg.Client({ connectionString: url });
await db.connect();
let applied;
try {
  applied = new Set((await db.query(`select name from ${schema}.applied_migrations`)).rows.map((r) => r.name));
} catch (e) {
  // undefined_table: the schema was never installed.
  if (e.code !== '42P01') throw e;
  console.error(`${schema} is not installed. Run \`npm run infra\` to install it.`);
  process.exit(1);
} finally {
  await db.end();
}
const missing = wanted.filter((m) => !applied.has(m));
if (missing.length) {
  console.error(`${schema} is missing ${missing.join(', ')}.`);
  console.error('Run `npm run infra` to install the missing migrations.');
  process.exit(1);
}
console.log(`${schema} has all ${wanted.length} migrations.`);
