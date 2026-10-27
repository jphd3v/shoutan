#!/usr/bin/env node
// Creates or repairs the whole hosted deployment from one file outside the repository:
// ~/.config/shoutan/infra.env (template: infra/infra.env.example). Run it from the repository root:
//
//   npm run infra -- --plan     show what would change, change nothing
//   npm run infra               create what is missing, repair what drifted
//
// Safe to run any number of times. After deleting the Supabase project or the GitHub
// repository, run it again to recreate them (data is not recreated: a new project starts
// empty). Run it yourself, not from an agent: it uses your Supabase token and your gh login.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { authChanges, hasOwnMail } from './lib/auth-config.mjs';
import { INFRA_ENV, REPORTS_ENV } from './lib/config.mjs';
import { HOSTED_SCHEMA, schemaSql } from './lib/schema.mjs';
import { supabaseManagement } from './lib/supabase-management.mjs';

const POLL_MS = Number(process.env.GO_INFRA_POLL_MS ?? 10_000);
const plan = process.argv.includes('--plan');
const LABELS = {
  'from-app': ['C5DEF5', 'Sent from the app'],
  bug: ['D73A4A', 'Something is wrong'],
  crash: ['B60205', 'Error or crash reported automatically'],
  idea: ['A2EEEF', 'A suggestion'],
  family: ['FBCA04', 'From the family app (Go)'],
  dev: ['EDEDED', 'From Shoutan Dev'],
  'size:S': ['C2E0C6', 'Small: an hour or two'],
  'size:M': ['FEF2C0', 'Medium: about a day'],
  'size:L': ['F9D0C4', 'Large: several days, or needs splitting'],
  'priority:high': ['B60205', 'The owner wants this next'],
  'priority:medium': ['FBCA04', 'Normal priority (an issue without a priority counts as this)'],
  'priority:low': ['C5DEF5', 'Nice to have, after the rest'],
};
const REQUIRED = [
  'SUPABASE_ACCESS_TOKEN',
  'GO_FAMILY_CODE',
  'GO_REPORTS_DB_PASSWORD',
  'GITHUB_REPO',
  'GO_KEYSTORE_FILE',
  'GO_KEYSTORE_PASSWORD',
  'GO_KEY_ALIAS',
];

let changes = 0;
const ok = (what) => console.log(`  ✓ ${what}`);
const change = (what) => {
  changes++;
  console.log(`  ${plan ? 'would' : '+'} ${what}`);
};
const stop = (problems) => {
  console.error(`\nStopped:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
};
const sqlText = (s) => `'${String(s).replaceAll("'", "''")}'`;

// ── Inputs ────────────────────────────────────────────────────────────────────
if (process.env.CLAUDECODE || process.env.CODEX_SANDBOX || process.env.CODEX_SANDBOX_NETWORK_DISABLED || process.env.GO_AGENT) {
  stop(['npm run infra uses your own Supabase token and GitHub login: run it yourself, not from an agent']);
}
if (!existsSync('app.config.ts') || !existsSync('supabase/migrations')) stop(['run this from the repository root']);
if (!existsSync(INFRA_ENV)) stop([`${INFRA_ENV} is missing: copy infra/infra.env.example there and fill it in`]);
const env = parseEnv(readFileSync(INFRA_ENV, 'utf8'));
// Shared mode: Go lives as schemas in an existing project that other apps also use.
// Otherwise Go gets a project of its own, created by name when missing.
const shared = Boolean(env.SUPABASE_PROJECT_REF);
const required = [
  ...REQUIRED,
  ...(shared ? [] : ['SUPABASE_ORG_SLUG', 'SUPABASE_PROJECT_NAME', 'SUPABASE_REGION', 'SUPABASE_DB_PASSWORD']),
];
const missing = required.filter((k) => !env[k]);
if (missing.length) stop([`${INFRA_ENV} lacks ${missing.join(', ')}`]);
const problems = [];
if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO)) problems.push('GITHUB_REPO must look like owner/name');
if (!/^[A-Za-z0-9_-]{16,}$/.test(env.GO_REPORTS_DB_PASSWORD)) problems.push('GO_REPORTS_DB_PASSWORD needs 16+ letters, digits, - or _');
// The database can't count wrong guesses (a refused code rolls back with its call), so the code's length is the defence.
if (env.GO_FAMILY_CODE.length < 12) problems.push('GO_FAMILY_CODE needs 12+ characters: anyone with the app can try codes');
const expandHome = (path) => path.replace(/^~(?=\/)/, homedir());
const keystore = expandHome(env.GO_KEYSTORE_FILE);
if (!existsSync(keystore)) {
  problems.push(
    `the signing key ${keystore} is missing. Restore it from your backup; only for a first setup create one with:\n` +
      `    keytool -genkeypair -v -storetype PKCS12 -keystore ${keystore} -alias ${env.GO_KEY_ALIAS} -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Shoutan"`,
  );
} else if (
  spawnSync('keytool', ['-list', '-keystore', keystore, '-storepass', env.GO_KEYSTORE_PASSWORD, '-alias', env.GO_KEY_ALIAS]).status !== 0
) {
  problems.push(`the signing key ${keystore} does not open with GO_KEYSTORE_PASSWORD and alias ${env.GO_KEY_ALIAS}`);
}
// Optional: the Google Play service account's JSON key, and whether releases upload to internal testing.
const playKey = env.GO_PLAY_SERVICE_ACCOUNT_FILE ? expandHome(env.GO_PLAY_SERVICE_ACCOUNT_FILE) : undefined;
const playUpload = env.GO_PLAY_INTERNAL_UPLOAD || 'off';
if (!['on', 'off'].includes(playUpload)) problems.push('GO_PLAY_INTERNAL_UPLOAD must be on or off');
if (playUpload === 'on' && !playKey) problems.push('GO_PLAY_INTERNAL_UPLOAD=on needs GO_PLAY_SERVICE_ACCOUNT_FILE');
if (playKey) {
  let key;
  try {
    key = JSON.parse(readFileSync(playKey, 'utf8'));
  } catch {
    problems.push(`the Google Play key ${playKey} is missing or not JSON`);
  }
  if (key && !(key.type === 'service_account' && key.client_email && key.private_key))
    problems.push(`the Google Play key ${playKey} is not a service account's JSON key`);
}
if (problems.length) stop(problems);

const repo = env.GITHUB_REPO;
const migrations = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).length;
console.log(plan ? 'Plan: nothing will be changed.\n' : '');

// ── Supabase ──────────────────────────────────────────────────────────────────
console.log('Supabase');
const sb = supabaseManagement({ token: env.SUPABASE_ACCESS_TOKEN });
// A shared project is fetched by ref: a token limited to that project cannot list projects.
async function sharedProject() {
  try {
    const p = await sb.project(env.SUPABASE_PROJECT_REF);
    return p.status === 'REMOVED' ? undefined : p;
  } catch (e) {
    if (/: 404 /.test(e.message)) return undefined;
    throw e;
  }
}
let project;
if (shared) project = await sharedProject();
else {
  const named = (await sb.projects()).filter(
    (p) => p.status !== 'REMOVED' && p.name === env.SUPABASE_PROJECT_NAME && p.organization_slug === env.SUPABASE_ORG_SLUG,
  );
  if (named.length > 1) stop([`more than one project named ${env.SUPABASE_PROJECT_NAME} in ${env.SUPABASE_ORG_SLUG}`]);
  project = named[0];
}
if (project) ok(`${shared ? 'shared ' : ''}project ${project.name} (${project.ref})`);
else if (shared) {
  stop([
    `the shared project ${env.SUPABASE_PROJECT_REF} does not exist. npm run infra never creates or replaces a shared project, ` +
      'because other apps live in it. Create or restore it, or set SUPABASE_PROJECT_REF to the right one.',
  ]);
} else {
  change(`create project ${env.SUPABASE_PROJECT_NAME} in ${env.SUPABASE_ORG_SLUG} (${env.SUPABASE_REGION})`);
  if (!plan) {
    project = await sb.createProject({
      name: env.SUPABASE_PROJECT_NAME,
      organizationSlug: env.SUPABASE_ORG_SLUG,
      dbPass: env.SUPABASE_DB_PASSWORD,
      region: env.SUPABASE_REGION,
    });
  }
}

let supabaseUrl;
let publishableKey;
let authByHand;
let noMail;
let reportsUrl;
if (project) {
  const ref = project.ref;
  supabaseUrl = `https://${ref}.supabase.co`;
  if (['INACTIVE', 'PAUSING'].includes(project.status)) {
    stop([`the project is paused: restore it at https://supabase.com/dashboard/project/${ref}, then run this again`]);
  }
  if (!plan && project.status !== 'ACTIVE_HEALTHY') {
    process.stdout.write('  … waiting for the project to start');
    for (let i = 0; (await sb.project(ref)).status !== 'ACTIVE_HEALTHY'; i++) {
      if (i > 90) stop(['the project did not become healthy within 15 minutes; check the dashboard and run this again']);
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    console.log('');
  }

  // Project-wide: email codes for everyone, and no anonymous users (Go's database refuses them too).
  const auth = await sb.authConfig(ref);
  const { patch, changes: authWork } = authChanges(auth);
  if (!authWork.length) ok('email sign-in with a code; anonymous sign-ins off');
  for (const c of authWork) change(c);
  if (authWork.length && !plan) {
    try {
      await sb.updateAuthConfig(ref, patch);
    } catch (e) {
      // A scoped token needs project admin rights to change auth settings; doing it by hand is simpler.
      if (!/: 403 /.test(e.message)) throw e;
      authByHand = { url: `https://supabase.com/dashboard/project/${ref}/auth/providers`, changes: authWork };
      console.log('  ! this token may not change auth settings; make these changes by hand');
    }
  }
  if (!hasOwnMail(auth)) {
    noMail = `https://supabase.com/dashboard/project/${ref}/auth/smtp`;
    console.log('  ! no mail server of its own: sign-in codes reach only the project team');
  }

  // Both apps use this schema, so every migration must keep the older stable app working.
  const schema = HOSTED_SCHEMA;
  let schemaReady = true;
  // Postgres resolves table names before running a query, so check existence separately.
  const [exists] = await sb.query(ref, `select to_regclass('${schema}.applied_migrations') is not null as installed`);
  const applied = exists.installed ? Number((await sb.query(ref, `select count(*)::int as n from ${schema}.applied_migrations`))[0].n) : 0;
  const pending = migrations - applied;
  if (pending <= 0) ok(`${schema} has all ${migrations} migrations`);
  else {
    change(`install ${pending} migration(s) into ${schema}`);
    if (plan) schemaReady = false;
    else await sb.query(ref, schemaSql(schema));
  }

  const exposed = (await sb.postgrestConfig(ref)).db_schema.split(',').map((s) => s.trim());
  // An exposed schema that does not exist stops the Data API for every app in the project
  // (PGRST002). Only Go's own leftovers are removed; other apps' entries are not Go's to touch.
  const present = new Set((await sb.query(ref, `select nspname as name from pg_namespace where nspname like 'go%'`)).map((r) => r.name));
  const stale = exposed.filter((s) => /^go(_[a-z_]+)?$/.test(s) && s !== schema && !present.has(s));
  if (stale.length) change(`stop exposing ${stale.join(', ')} (they no longer exist and break the Data API)`);
  const wanted = [...exposed.filter((s) => !stale.includes(s)), ...(exposed.includes(schema) ? [] : [schema])];
  if (exposed.includes(schema)) ok(`${schema} exposed to the app`);
  else change(`expose ${schema} to the app`);
  if (!plan && wanted.join(',') !== exposed.join(',')) await sb.updatePostgrestConfig(ref, { db_schema: wanted.join(',') });

  if (!schemaReady) change('set the family code after installing the schema');
  else {
    const [row] = await sb.query(
      ref,
      `select (select value from ${schema}.settings where key = 'family_code') = ${sqlText(env.GO_FAMILY_CODE)} as same`,
    );
    if (row?.same) ok('family code');
    else {
      change('set the family code');
      if (!plan) {
        await sb.query(
          ref,
          `insert into ${schema}.settings (key, value) values ('family_code', ${sqlText(env.GO_FAMILY_CODE)})
           on conflict (key) do update set value = excluded.value`,
        );
      }
    }
  }

  const keys = await sb.apiKeys(ref);
  publishableKey = keys.find((k) => k.type === 'publishable')?.api_key;
  if (!publishableKey) stop([`no publishable key: create one at https://supabase.com/dashboard/project/${ref}/settings/api-keys`]);

  const poolers = await sb.pooler(ref);
  const pooler = (Array.isArray(poolers) ? poolers : [poolers]).find((p) => p.database_type === 'PRIMARY');
  if (!pooler) stop(['no connection pooler reported for the project']);
  // Session mode lives on port 5432 of the pooler host; the reports login needs real transactions.
  const port = pooler.pool_mode === 'session' ? pooler.db_port : 5432;
  const user = pooler.db_user.includes('.') ? `go_reports.${pooler.db_user.split('.').slice(1).join('.')}` : 'go_reports';
  reportsUrl = `postgresql://${user}:${env.GO_REPORTS_DB_PASSWORD}@${pooler.db_host}:${port}/postgres`;

  const works = await reportsLoginWorks(reportsUrl);
  if (works) ok('reports login connects and reads the migration ledger');
  else {
    change('set the go_reports login password');
    if (!plan) {
      await sb.query(ref, `alter role go_reports password ${sqlText(env.GO_REPORTS_DB_PASSWORD)}`);
      if (!(await reportsLoginWorks(reportsUrl))) stop([`the reports login still cannot connect through ${pooler.db_host}:${port}`]);
    }
  }
}

async function reportsLoginWorks(url) {
  const db = new pg.Client({ connectionString: url });
  try {
    await db.connect();
    const { rows } = await db.query(`select count(*)::int as n from ${HOSTED_SCHEMA}.applied_migrations`);
    return rows[0].n === migrations;
  } catch {
    return false;
  } finally {
    await db.end().catch(() => {});
  }
}

// ── Local settings ────────────────────────────────────────────────────────────
console.log('\nLocal settings');
const envFile = (values) =>
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}\n`)
    .join('');
const files = [
  ['.env.dev.local', { SUPABASE_URL: supabaseUrl, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SCHEMA: HOSTED_SCHEMA }],
  ['.env.prod.local', { SUPABASE_URL: supabaseUrl, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SCHEMA: HOSTED_SCHEMA }],
  [
    '.env.signing.local',
    {
      GO_KEYSTORE_FILE: keystore,
      GO_KEYSTORE_PASSWORD: env.GO_KEYSTORE_PASSWORD,
      GO_KEY_ALIAS: env.GO_KEY_ALIAS,
      GO_KEY_PASSWORD: env.GO_KEY_PASSWORD || env.GO_KEYSTORE_PASSWORD,
    },
  ],
  [REPORTS_ENV, { GO_REPORTS_DATABASE_URL: reportsUrl, GO_SCHEMAS: HOSTED_SCHEMA }],
];
for (const [path, values] of files) {
  if (Object.values(values).some((v) => v === undefined)) {
    change(`write ${path} once the project exists`);
    continue;
  }
  const content = envFile(values);
  if (existsSync(path) && readFileSync(path, 'utf8') === content) ok(path);
  else {
    change(`write ${path}`);
    if (!plan) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, { mode: 0o600 });
      chmodSync(path, 0o600);
    }
  }
}

// ── GitHub ────────────────────────────────────────────────────────────────────
console.log('\nGitHub');
const gh = (args, input) => spawnSync('gh', args, { encoding: 'utf8', input });
if (gh(['auth', 'status']).status !== 0) stop(['gh is not signed in: run `gh auth login`']);
const view = gh(['repo', 'view', repo, '--json', 'visibility,sshUrl,url']);
let info = view.status === 0 ? JSON.parse(view.stdout) : null;
if (info) ok(`${repo} exists (${info.visibility.toLowerCase()})`);
else {
  change(`create the private repository ${repo}`);
  if (!plan) {
    const created = gh(['repo', 'create', repo, '--private']);
    if (created.status !== 0) stop([`could not create ${repo}: ${created.stderr.trim()}`]);
    info = JSON.parse(gh(['repo', 'view', repo, '--json', 'visibility,sshUrl,url']).stdout);
  }
}

if (info) {
  const git = (...a) => spawnSync('git', a, { encoding: 'utf8' });
  const origin = git('remote', 'get-url', 'origin');
  const remoteUrl = env.GITHUB_REMOTE_URL || info.sshUrl;
  if (origin.status === 0) ok(`origin is ${origin.stdout.trim()}`);
  else {
    change(`add origin ${remoteUrl}`);
    if (!plan) git('remote', 'add', 'origin', remoteUrl);
  }
  const heads = git('ls-remote', '--heads', plan && origin.status !== 0 ? remoteUrl : 'origin', 'main');
  if (heads.status === 0 && heads.stdout.trim()) ok('main is on GitHub');
  else {
    change('push main');
    if (!plan) {
      const pushed = git('push', 'origin', 'main');
      if (pushed.status !== 0) stop([`could not push main: ${pushed.stderr.trim()}`]);
    }
  }

  const current = gh(['label', 'list', '--repo', repo, '--json', 'name', '--limit', '200']);
  const have = new Set(current.status === 0 ? JSON.parse(current.stdout).map((l) => l.name) : []);
  const absent = Object.keys(LABELS).filter((l) => !have.has(l));
  if (!absent.length) ok('issue labels');
  for (const name of absent) {
    change(`create label ${name}`);
    if (!plan) gh(['label', 'create', name, '--repo', repo, '--color', LABELS[name][0], '--description', LABELS[name][1], '--force']);
  }

  const secrets = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    GO_REPORTS_DATABASE_URL: reportsUrl,
    GO_KEYSTORE_BASE64: readFileSync(keystore).toString('base64'),
    GO_KEYSTORE_PASSWORD: env.GO_KEYSTORE_PASSWORD,
    GO_KEY_ALIAS: env.GO_KEY_ALIAS,
    GO_KEY_PASSWORD: env.GO_KEY_PASSWORD || env.GO_KEYSTORE_PASSWORD,
    ...(playKey && { PLAY_SERVICE_ACCOUNT_JSON: readFileSync(playKey, 'utf8') }),
  };
  // GitHub never shows secret values back, so they are rewritten on every run (not counted as a change).
  if (Object.values(secrets).some((v) => v === undefined)) change('set the Actions secrets once the project exists');
  else if (plan) console.log(`  ↻ would rewrite ${Object.keys(secrets).length} Actions secrets`);
  else {
    for (const [name, value] of Object.entries(secrets)) {
      const r = gh(['secret', 'set', name, '--repo', repo], value);
      if (r.status !== 0) stop([`could not set secret ${name}: ${r.stderr.trim()}`]);
    }
    console.log(`  ↻ rewrote ${Object.keys(secrets).length} Actions secrets`);
  }

  // Release Shoutan uploads to Google Play's internal testing track only while this is true.
  const wantUpload = String(playUpload === 'on');
  const upload = gh(['variable', 'get', 'PLAY_INTERNAL_UPLOAD', '--repo', repo]);
  if (upload.status === 0 && upload.stdout.trim() === wantUpload) ok(`Google Play internal testing uploads ${playUpload}`);
  else {
    change(`turn Google Play internal testing uploads ${playUpload}`);
    if (!plan) {
      const r = gh(['variable', 'set', 'PLAY_INTERNAL_UPLOAD', '--repo', repo, '--body', wantUpload]);
      if (r.status !== 0) stop([`could not set variable PLAY_INTERNAL_UPLOAD: ${r.stderr.trim()}`]);
    }
  }
}

// ── Claude Code ───────────────────────────────────────────────────────────────
console.log('\nClaude Code');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
// No agent may read the owner's secrets (the Read rule covers Claude's file tools, denyRead the
// sandboxed commands).
const localPath = `${root}/.claude/settings.local.json`;
const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : {};
const secretsOnDisk = [INFRA_ENV, keystore, ...(playKey ? [playKey] : [])];
const wantedLocal = {
  ...local,
  permissions: {
    ...local.permissions,
    deny: [...new Set([...(local.permissions?.deny ?? []), ...secretsOnDisk.map((p) => `Read(/${p})`)])],
  },
  sandbox: {
    ...local.sandbox,
    filesystem: {
      ...local.sandbox?.filesystem,
      denyRead: [...new Set([...(local.sandbox?.filesystem?.denyRead ?? []), ...secretsOnDisk])],
    },
  },
};
if (JSON.stringify(local) === JSON.stringify(wantedLocal)) ok('agents here cannot read the owner secrets');
else {
  change('hide the owner secrets from agents here (.claude/settings.local.json)');
  if (!plan) {
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, JSON.stringify(wantedLocal, null, 2) + '\n', { mode: 0o600 });
  }
}

console.log(
  `\n${plan ? `${changes} change(s) planned.` : changes ? 'Done.' : 'Everything was already in place.'}` +
    (authByHand ? `\nSign-in needs changes by hand at ${authByHand.url}: ${authByHand.changes.join('; ')}.` : '') +
    (noMail
      ? `\nFamily sign-in needs a mail server: set up custom SMTP at ${noMail} (another app in the project may already have one), then run npm run status.`
      : '') +
    (plan ? '' : '\nNext: on GitHub, Actions → "Release Shoutan Dev" → Run workflow builds a Shoutan Dev APK.'),
);
