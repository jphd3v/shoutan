/**
 * The reports login (go_reports) as the report poller and release checks use it:
 * it reads reports and sets their status, and is refused everything else.
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import pg from 'pg';
import { GoApi } from '../../src/net/api';
import { authAdmin, emailSession } from '../../scripts/lib/test-identity';

const SCHEMA = process.env.SUPABASE_SCHEMA ?? 'public';
const reportsUrl = process.env.GO_REPORTS_DATABASE_URL!;
const env = { ...process.env, GO_SCHEMAS: SCHEMA };
const cli = (...args: string[]) => execFileSync(process.execPath, ['scripts/reports.mjs', ...args], { encoding: 'utf8', env });

const phoneDb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const reports = new pg.Client({ connectionString: reportsUrl });

after(async () => {
  await reports.end();
  await phoneDb.realtime.disconnect();
});

describe('reports login', () => {
  it('lists new reports and sets their status and notes', async () => {
    const message = `Reports test ${Date.now()}`;
    await emailSession(authAdmin(), phoneDb);
    const phone = new GoApi(phoneDb, SCHEMA);
    await phone.register(`Reports ${Date.now().toString(36)}`, 'local-family');
    await phone.sendReports([{ kind: 'bug', message, details: { game: '9x9' } }]);

    const listed = JSON.parse(cli('list'))[SCHEMA] as { id: number; message: string; status: string }[];
    const report = listed.find((r) => r.message === message);
    assert.ok(report, 'new report listed');

    assert.match(cli('set', SCHEMA, String(report.id), 'accepted', 'Reproduced'), /is now accepted/);
    const accepted = JSON.parse(cli('list', '--status', 'accepted'))[SCHEMA] as { id: number; notes: string }[];
    assert.equal(accepted.find((r) => r.id === report.id)?.notes, 'Reproduced');
  });

  it('cannot read players, games, events or family codes, nor rewrite or add reports', async () => {
    await reports.connect();
    for (const table of ['players', 'games', 'game_events', 'settings']) {
      await assert.rejects(reports.query(`select * from ${SCHEMA}.${table} limit 1`), /permission denied/, table);
    }
    await assert.rejects(reports.query(`update ${SCHEMA}.reports set message = 'x'`), /permission denied/);
    await assert.rejects(reports.query(`insert into ${SCHEMA}.reports (kind, message) values ('bug', 'x')`), /permission denied/);
    await assert.rejects(reports.query(`delete from ${SCHEMA}.reports`), /permission denied/);
    await assert.rejects(reports.query('select * from auth.users limit 1'), /permission denied/);
  });

  it('confirms the hosted schema has every migration', { skip: SCHEMA === 'public' && 'only hosted-style schemas keep a ledger' }, () => {
    const out = execFileSync(process.execPath, ['scripts/check-hosted-schema.mjs', SCHEMA], { encoding: 'utf8', env });
    assert.match(out, /has all \d+ migrations/);
  });
});
