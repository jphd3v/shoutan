#!/usr/bin/env node
// The README's online screenshot: John Doe, played from here through the local stack, against Jane Doe
// on the emulator (e2e/readme-online.yaml). Needs the local stack and the Shoutan Local APK installed:
//   node --import tsx scripts/readme-online.mjs
import { createClient } from '@supabase/supabase-js';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { GoApi } from '../src/net/api.ts';
import { MatchSync } from '../src/net/match.ts';
import { pointFromName } from '../src/go/rules.ts';
import { emailSession } from './lib/test-identity.ts';
import { maestroBin, maestroEnv } from './lib/maestro.mjs';

const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' }));
if (!['127.0.0.1', 'localhost'].includes(new URL(status.API_URL).hostname)) throw new Error('Needs the local stack');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(status.API_URL, status.SECRET_KEY, opts);
const MAILPIT_URL = status.MAILPIT_URL ?? status.INBUCKET_URL ?? 'http://127.0.0.1:54324';

// Names are unique, so the players an earlier run left behind go first, with all they hold.
const { data: earlier, error } = await db.from('players').select('id').in('name', ['Jane Doe', 'John Doe']);
if (error) throw error;
for (const { id } of earlier) await db.auth.admin.deleteUser(id);

const phone = createClient(status.API_URL, status.PUBLISHABLE_KEY, opts);
await emailSession(db, phone);
const peer = new GoApi(phone);
await peer.register('John Doe', 'local-family');
await peer.setMyAvatar('🦉');

const flow = spawn(
  maestroBin,
  [
    'test',
    '-e',
    'APP_ID=io.github.jphd3v.shoutan.local',
    '-e',
    `MAILPIT_URL=${MAILPIT_URL}`,
    '-e',
    `EMAIL=jane-${Date.now()}@example.com`,
    '--test-output-dir',
    'e2e-output/readme',
    'e2e/readme-online.yaml',
  ],
  { stdio: 'inherit', env: maestroEnv },
);
const finished = new Promise((ok, bad) => flow.once('exit', (c) => (c === 0 ? ok() : bad(new Error(`flow exited ${c}`)))));

const until = async (fn) => {
  for (const end = Date.now() + 600_000; Date.now() < end; await delay(300)) {
    const r = await fn();
    if (r) return r;
  }
  throw new Error('timed out');
};
const one = async (q) => {
  const { data, error } = await q;
  if (error) throw error;
  return data;
};

const opponent = async () => {
  const jane = await until(() => one(db.from('players').select('id').eq('name', 'Jane Doe').maybeSingle()));
  const game = await until(() => one(db.from('games').select('id').eq('created_by', jane.id).eq('status', 'open').maybeSingle()));
  await peer.joinGame(game.id);
  const sync = new MatchSync(peer, game.id, (await peer.me()).id, (p) => {
    throw new Error(`integrity problem at ${p.n}: ${p.reason}`);
  });
  const moves = ['D3', 'G3', 'D4', 'G5', 'F7', 'D7', 'B8'];
  for (const [i, at] of moves.entries()) {
    await until(async () => {
      const v = await sync.refresh();
      return v.kind === 'ready' && v.state.events.length === 2 * i + 1;
    });
    await delay(800);
    const r = await sync.act({ kind: 'play', color: 'white', point: pointFromName(9, at) });
    if (!r.ok) throw new Error(JSON.stringify(r.problem));
  }
};

await Promise.all([finished, opponent()]);
console.log('done');
process.exit(0);
