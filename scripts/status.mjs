#!/usr/bin/env node
// Shows how the hosted Go deployment is doing, in plain words, without the Supabase dashboard.
// Uses the Supabase token in ~/.config/shoutan/infra.env. Run it from the repository root:
//
//   npm run status                 read-only: health, settings, schema, players, games, reports
//   npm run status -- --restart    restart the Supabase project (takes a few minutes)
//
// Run it yourself, not from an agent: it uses your Supabase token.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { authChanges, hasOwnMail } from './lib/auth-config.mjs';
import { INFRA_ENV } from './lib/config.mjs';
import { HOSTED_SCHEMA } from './lib/schema.mjs';
import { supabaseManagement } from './lib/supabase-management.mjs';

const restart = process.argv.includes('--restart');
const schema = HOSTED_SCHEMA;

let problems = 0;
const ok = (what) => console.log(`  ✓ ${what}`);
const bad = (what, fix) => {
  problems++;
  console.log(`  ✗ ${what}${fix ? `\n      → ${fix}` : ''}`);
};
const info = (what) => console.log(`    ${what}`);
const stop = (why) => {
  console.error(`Stopped: ${why}`);
  process.exit(1);
};
/** Runs a step and reports a failure without stopping the rest. */
const attempt = async (what, fn) => {
  try {
    return await fn();
  } catch (e) {
    bad(`${what}: ${e.message.split('\n')[0].slice(0, 300)}`);
    return undefined;
  }
};

if (!existsSync('app.config.ts')) stop('run this from the repository root');
if (!existsSync(INFRA_ENV)) stop(`${INFRA_ENV} is missing: copy infra/infra.env.example there and fill it in`);
const env = parseEnv(readFileSync(INFRA_ENV, 'utf8'));
if (!env.SUPABASE_ACCESS_TOKEN) stop(`${INFRA_ENV} lacks SUPABASE_ACCESS_TOKEN`);
const sb = supabaseManagement({ token: env.SUPABASE_ACCESS_TOKEN });

const project = env.SUPABASE_PROJECT_REF
  ? await sb.project(env.SUPABASE_PROJECT_REF)
  : (await sb.projects()).find((p) => p.status !== 'REMOVED' && p.name === env.SUPABASE_PROJECT_NAME);
if (!project) stop('no Supabase project found; run npm run infra first');
const ref = project.ref;
const url = `https://${ref}.supabase.co`;
console.log(`Supabase project ${project.name} (${ref}), ${project.region}`);
console.log(`Dashboard: https://supabase.com/dashboard/project/${ref}\n`);

if (restart) {
  try {
    await sb.restart(ref);
  } catch (e) {
    // A scoped token lacks project admin rights; the dashboard has the same button.
    if (!/: 403 /.test(e.message)) throw e;
    stop(
      `this token may not restart the project. Restart it by hand: https://supabase.com/dashboard/project/${ref}/settings/general → Restart project`,
    );
  }
  console.log('Restart requested. It takes a few minutes; run npm run status again to see when it is healthy.');
  process.exit(0);
}

console.log('Project');
if (project.status === 'ACTIVE_HEALTHY') ok('running');
else if (['INACTIVE', 'PAUSING', 'PAUSED'].includes(project.status))
  bad(`paused (${project.status})`, `restore it: https://supabase.com/dashboard/project/${ref}`);
else bad(`status ${project.status}`, 'npm run status -- --restart');

const services = ['auth', 'db', 'rest', 'realtime', 'storage'];
const health = await attempt('service health', () => sb.health(ref, services));
for (const s of health ?? []) {
  if (s.healthy) ok(`${s.name} healthy`);
  else
    bad(`${s.name} unhealthy${s.error ? `: ${s.error}` : ''}`, s.name === 'rest' ? 'see "Data API" below' : 'npm run status -- --restart');
}

console.log('\nSign-in');
const auth = await attempt('auth settings', () => sb.authConfig(ref));
if (auth) {
  const { changes } = authChanges(auth);
  if (!changes.length) ok('email sign-in with a code; anonymous sign-ins off');
  for (const c of changes) bad(`sign-in settings drifted: ${c}`, 'npm run infra');
  if (hasOwnMail(auth)) ok(`own mail server (${auth.smtp_host})`);
  else
    bad(
      'no mail server of its own: sign-in codes reach only the project team',
      `set up custom SMTP: https://supabase.com/dashboard/project/${ref}/auth/smtp`,
    );
  if (auth.disable_signup) bad('new sign-ups are switched off', 'family members need sign-ups on for their first email sign-in');
}

console.log('\nData API (what the app talks to)');
const postgrest = await attempt('exposed schemas', () => sb.postgrestConfig(ref));
const exposed = postgrest ? postgrest.db_schema.split(',').map((s) => s.trim()) : [];
const existing = await attempt('schemas in the database', async () =>
  (await sb.query(ref, 'select nspname as name from pg_namespace')).map((r) => r.name),
);
if (postgrest) {
  info(`exposed schemas: ${exposed.join(', ')}`);
  if (exposed.includes(schema)) ok(`${schema} is exposed`);
  else bad(`${schema} is not exposed`, 'npm run infra');
  // A listed schema that does not exist stops the Data API from loading at all (PGRST002).
  const missing = existing ? exposed.filter((s) => !existing.includes(s)) : [];
  for (const s of missing)
    bad(
      `exposed schema "${s}" does not exist in the database: this breaks the whole Data API`,
      s.startsWith('go') ? 'npm run infra removes Go’s leftovers' : 'create it, or remove it from the exposed schemas',
    );
}
const probe = await attempt('reach the Data API', async () => {
  const keys = await sb.apiKeys(ref);
  const key = keys.find((k) => k.type === 'publishable')?.api_key ?? keys.find((k) => k.name === 'anon')?.api_key;
  const r = await fetch(`${url}/rest/v1/games?select=id&limit=1`, { headers: { apikey: key, 'Accept-Profile': schema } });
  return { status: r.status, body: await r.text() };
});
if (probe) {
  if (probe.status === 200 || probe.status === 401)
    ok(`the app can reach ${schema}${probe.status === 401 ? ' (and it asks for sign-in, as it should)' : ''}`);
  else {
    const code = /"code":"(\w+)"/.exec(probe.body)?.[1] ?? '';
    bad(
      `the app gets HTTP ${probe.status} ${code}: ${probe.body.slice(0, 160)}`,
      code === 'PGRST002' ? 'the Data API cannot read the database; fix the items above, then npm run status -- --restart' : undefined,
    );
  }
}

console.log(`\nGo data (schema ${schema})`);
const installed = await attempt(
  'schema check',
  async () => (await sb.query(ref, `select to_regclass('${schema}.games') is not null as yes`))[0].yes,
);
if (installed === false) bad(`schema ${schema} is not installed`, 'npm run infra');
if (installed) {
  const local = existsSync('supabase/migrations') ? readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).length : 0;
  const counts = await attempt(
    'counts',
    async () =>
      (
        await sb.query(
          ref,
          `
    select (select count(*) from ${schema}.applied_migrations)::int as migrations,
           (select count(*) from ${schema}.players)::int as players,
           (select count(*) from ${schema}.games)::int as games,
           (select count(*) from ${schema}.reports)::int as reports,
           (select count(*) from auth.users where is_anonymous)::int as anonymous_users`,
        )
      )[0],
  );
  if (counts) {
    if (counts.migrations >= local) ok(`all ${local} migrations applied`);
    else bad(`${counts.migrations} of ${local} migrations applied`, 'npm run infra');
    info(
      `${counts.players} players, ${counts.games} games, ${counts.reports} reports, ${counts.anonymous_users} anonymous sign-ins in the project`,
    );
  }
  const reports = await attempt('newest reports', () =>
    sb.query(
      ref,
      `select created_at, kind, left(coalesce(message, ''), 70) as text from ${schema}.reports order by created_at desc limit 3`,
    ),
  );
  for (const r of reports ?? []) info(`report ${String(r.created_at).slice(0, 16)} ${r.kind}: ${r.text}`);
}

console.log('\nRecent database errors (last hour)');
let errors;
try {
  errors = await sb.logs(
    ref,
    `select timestamp, event_message from postgres_logs
     where regexp_contains(event_message, '^(ERROR|FATAL)') order by timestamp desc limit 5`,
    new Date(Date.now() - 3600_000),
  );
} catch (e) {
  // Reading logs needs a token permission that infra's token often lacks; it is only extra detail.
  if (/: 403 /.test(e.message))
    info(`skipped: this token may not read logs (https://supabase.com/dashboard/project/${ref}/logs/postgres-logs)`);
  else bad(`database logs: ${e.message.split('\n')[0].slice(0, 300)}`);
}
const rows = errors?.result ?? [];
if (errors && !rows.length) ok('none');
for (const r of rows) info(`${new Date(r.timestamp / 1000).toISOString().slice(11, 19)} ${String(r.event_message).slice(0, 160)}`);

console.log(problems ? `\n${problems} problem(s) found.` : '\nEverything looks fine.');
process.exit(problems ? 1 : 0);
