import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import pg from 'pg';
import { GoApi } from '../../src/net/api';
import { emailSession } from '../../scripts/lib/test-identity';

const schema = process.env.SUPABASE_SCHEMA ?? 'public';
const client = (key = process.env.SUPABASE_PUBLISHABLE_KEY!) =>
  createClient(process.env.SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

describe('family authentication', () => {
  it('restores the same verified email identity and membership on another device', async () => {
    const admin = client(process.env.SUPABASE_SECRET_KEY);
    const first = client();
    const session = await emailSession(admin, first);
    const a = new GoApi(first, schema);
    await a.register(`Email ${session.user.id.slice(0, 8)}`, 'local-family');
    const second = client();
    await emailSession(admin, second, session.user.email!);
    const b = new GoApi(second, schema);
    assert.deepEqual(await b.account(), await a.account());
    assert.deepEqual(await b.me(), await a.me());
    await a.signOut();
    assert.equal(await a.account(), null);
    assert.equal((await b.account())?.id, session.user.id);
  });

  it('denies feedback to a permanent nonmember, including direct database calls', async () => {
    const db = client();
    await emailSession(client(process.env.SUPABASE_SECRET_KEY), db);
    const r = await db.schema(schema).from('reports').insert({ kind: 'bug', message: 'nonmember', details: {} });
    assert.ok(r.error, 'nonmembers must not insert feedback');
  });

  it('rejects an anonymous token even if its user already has a player row', async () => {
    const db = client();
    const session = await emailSession(client(process.env.SUPABASE_SECRET_KEY), db);
    await new GoApi(db, schema).register(`Legacy ${session.user.id.slice(0, 8)}`, 'local-family');
    const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
    await sql.connect();
    try {
      await sql.query('begin');
      await sql.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: session.user.id, role: 'authenticated', is_anonymous: true, email: '' }),
      ]);
      await sql.query('set local role authenticated');
      assert.equal((await sql.query(`select count(*)::int as n from ${schema}.players`)).rows[0].n, 0);
      await assert.rejects(sql.query(`select ${schema}.register_player('Legacy', 'local-family')`), /not_signed_in/);
    } finally {
      await sql.query('rollback');
      await sql.end();
    }
  });
});
