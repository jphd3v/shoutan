#!/usr/bin/env node
// Applies pending migrations to the local Supabase stack and runs the database tests
// twice: against `public` (the local migrations) and against `go` installed by
// scripts/schema-sql.mjs, the same SQL the hosted project gets. Needs Docker and a started stack: `npx supabase start`. The tests create
// fresh email players, so they don't need an empty database; only reports from earlier runs are
// cleared, since npm run reports lists at most 100 of a status. A `db reset` is avoided
// because it restarts Realtime, which then misses database changes for a while.
import { createClient } from '@supabase/supabase-js';
import { execFileSync, spawnSync } from 'node:child_process';

const supabase = (...args) => execFileSync('npx', ['supabase', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

let status;
try {
  status = JSON.parse(supabase('status', '-o', 'json'));
} catch {
  console.error('The local Supabase stack is not running. Start it with `npx supabase start` (needs Docker).');
  process.exit(1);
}
supabase('migration', 'up', '--local');
const hostedSql = execFileSync(process.execPath, ['scripts/schema-sql.mjs', 'go'], { encoding: 'utf8' });
execFileSync('docker', ['exec', '-i', 'supabase_db_shoutan', 'psql', '-q', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input: `${hostedSql}
insert into go.settings (key, value) values ('family_code', 'local-family') on conflict (key) do nothing;
-- The local stack keeps reports between runs: clear them, and lift the hosted daily cap that would stop the tests after a few.
delete from public.reports;
delete from go.reports;
insert into public.settings (key, value) values ('reports_per_day', '100000') on conflict (key) do update set value = excluded.value;
insert into go.settings (key, value) values ('reports_per_day', '100000') on conflict (key) do update set value = excluded.value;
alter role go_reports password 'local-reports-login';
notify pgrst, 'reload schema';`,
  stdio: ['pipe', 'ignore', 'inherit'],
});
await waitForRealtime(status.API_URL, status.PUBLISHABLE_KEY);

const env = {
  ...process.env,
  SUPABASE_URL: status.API_URL,
  SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  SUPABASE_DB_URL: status.DB_URL,
  GO_REPORTS_DATABASE_URL: Object.assign(new URL(status.DB_URL), { username: 'go_reports', password: 'local-reports-login' }).href,
};
let failed = false;
for (const schema of ['public', 'go']) {
  console.log(`\nDatabase tests against schema ${schema}`);
  const r = spawnSync(
    'npx',
    ['tsx', '--test', '--test-concurrency=1', '--test-timeout=20000', ...process.argv.slice(2), 'supabase/tests/*.test.ts'],
    {
      stdio: 'inherit',
      env: { ...env, SUPABASE_SCHEMA: schema },
    },
  );
  failed ||= r.status !== 0;
}
process.exit(failed ? 1 : 0);

/** The reset restarts the containers; Realtime accepts connections a few seconds after the database does. */
async function waitForRealtime(url, key) {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const channel = db.channel(`ready-${Date.now()}`).subscribe((s) => {
        if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          void db.removeChannel(channel);
          resolve(s === 'SUBSCRIBED');
        }
      });
    });
    if (ok) {
      await db.realtime.disconnect();
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error('Realtime did not become ready within 60 s.');
  process.exit(1);
}
