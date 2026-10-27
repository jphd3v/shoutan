#!/usr/bin/env node
// Plays the online flows on the phone against API opponents that verify every event
// exactly as a phone does. Each flow has its own opponent script. Each waits for the emulator to
// answer first, and on CI a flow that failed plays once more with a new opponent and game: the
// runner's emulator has gone offline for a moment just after the offline flows turned networking back on.
import { createClient } from '@supabase/supabase-js';
import { execFileSync, spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { GoApi } from '../src/net/api.ts';
import { MatchSync } from '../src/net/match.ts';
import { pointFromName } from '../src/go/rules.ts';
import { recordPass } from './lib/device-results.mjs';
import { emailSession } from './lib/test-identity.ts';
import { maestroBin, maestroEnv } from './lib/maestro.mjs';
import { logTo } from './lib/quiet.mjs';

const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' }));
if (!['127.0.0.1', 'localhost'].includes(new URL(status.API_URL).hostname)) throw new Error('Online E2E requires the local stack');
const clients = [];
const client = (key) => {
  const c = createClient(status.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.push(c);
  return c;
};
const db = client(status.SECRET_KEY);
const authAdmin = client(status.SECRET_KEY);
// Mailpit, which catches the code the phone's sign-in emails (e2e/common/sign-in.yaml).
const MAILPIT_URL = status.MAILPIT_URL ?? status.INBUCKET_URL ?? 'http://127.0.0.1:54324';
const phoneEmail = (flow) => `phone-${flow}-${Date.now()}@example.com`;
// Names are unique and the local stack keeps players between runs, so each opponent has its own.
let opponents = 0;
const peerName = () => `E2E opponent ${Date.now().toString(36).slice(-5)}${++opponents}`;

async function opponentPhone() {
  const phone = client(status.PUBLISHABLE_KEY);
  await emailSession(authAdmin, phone);
  const peer = new GoApi(phone);
  await peer.register(peerName(), 'local-family');
  return peer;
}

function runFlow(file, env) {
  const args = ['test', '-e', 'APP_ID=io.github.jphd3v.shoutan.local', '-e', `MAILPIT_URL=${MAILPIT_URL}`];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push('--test-output-dir', 'e2e-output/online', file);
  const log = logTo(`e2e-output/online-${basename(file, '.yaml')}.log`);
  const flow = spawn(maestroBin, args, { stdio: log.stdio, env: maestroEnv });
  const finished = new Promise((resolve, reject) => {
    flow.once('error', reject);
    flow.once('exit', (code) => {
      log.done(code === 0);
      if (code === 0) resolve();
      else reject(new Error(`${file} exited ${code}`));
    });
  });
  return { flow, finished };
}

/** How long the opponent waits for the phone's next step; CI's slowest emulators took five minutes for a flow's setup. */
const STEP_SECONDS = 600;

/**
 * Waits for what the phone does, each wait up to `seconds` from when it starts. A deadline for the
 * whole flow would run out on a slow emulator (CI's) before the phone even reaches the step; a
 * flow that fails ends the wait anyway, as the flow and the opponent are awaited together.
 */
function waiter(seconds) {
  return async function until(fn) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      const result = await fn();
      if (result) return result;
      await delay(300);
    }
    throw new Error('Timed out waiting for the online UI');
  };
}

async function single(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function verifier(peer, gameId, me) {
  return new MatchSync(peer, gameId, me, (p) => {
    throw new Error(`Opponent found an integrity problem at event ${p.n}: ${p.reason}`);
  });
}

async function view(sync) {
  const v = await sync.refresh();
  if (v.kind === 'stopped') throw new Error(`Game stopped at event ${v.n}: ${v.reason}`);
  return v.kind === 'ready' ? v : null;
}

async function act(sync, event) {
  const r = await sync.act(event);
  if (!r.ok) throw new Error(`Opponent ${event.kind} refused: ${JSON.stringify(r.problem)}`);
}

/** 06: the phone creates a game, plays, passes, accepts and sends feedback from it. */
async function createAndFinish() {
  const name = `Phone-${Date.now()}`;
  const report = `Online test ${Date.now()}`;
  const peer = await opponentPhone();
  const until = waiter(STEP_SECONDS);
  const run = runFlow('e2e/06-online.yaml', { PLAYER_NAME: name, REPORT_MESSAGE: report, EMAIL: phoneEmail('06') });
  const opponent = async () => {
    const player = await until(() => single(db.from('players').select('id').eq('name', name).maybeSingle()));
    const game = await until(() => single(db.from('games').select('id').eq('created_by', player.id).eq('status', 'open').maybeSingle()));
    await peer.joinGame(game.id);
    const sync = verifier(peer, game.id, (await peer.me()).id);
    for (const [count, event] of [
      [1, { kind: 'play', color: 'white', point: pointFromName(9, 'C3') }],
      [3, { kind: 'pass', color: 'white' }],
      [5, { kind: 'accept', color: 'white' }],
    ]) {
      await until(async () => (await view(sync))?.state.events.length === count);
      await act(sync, event);
    }
    const end = await until(async () => {
      const v = await view(sync);
      return v?.row.status === 'over' ? v : null;
    });
    if (end.row.head_hash !== end.state.head) throw new Error('Finished game does not match the verified chain');
    const { avatar } = await single(db.from('players').select('avatar').eq('id', player.id).single());
    if (avatar !== '🦊') throw new Error(`The family sees avatar ${avatar}, not the one picked at the welcome`);
    await until(async () => {
      const data = await single(db.from('reports').select('player_name,details').eq('message', report).maybeSingle());
      if (!data) return false;
      if (data.player_name !== name || data.details.game_id !== game.id) throw new Error('Feedback lost its game context');
      return true;
    });
  };
  try {
    await Promise.all([run.finished, opponent()]);
  } finally {
    run.flow.kill();
  }
}

/**
 * 07: the opponent creates a game; the phone fails the family code once, renames, joins it,
 * captures, leaves and reopens it, marks a stone, keeps playing and resigns.
 */
async function joinAndResign() {
  const stamp = Date.now();
  const name = `Joiner-${stamp}`;
  const peer = await opponentPhone();
  const me = (await peer.me()).id;
  const gameId = await peer.createGame(9, 'black');
  const until = waiter(STEP_SECONDS);
  const run = runFlow('e2e/07-online-join.yaml', {
    FIRST_NAME: `New-${stamp}`,
    PLAYER_NAME: name,
    GAME_ID: gameId,
    EMAIL: phoneEmail('07'),
  });
  const at = (n) => pointFromName(9, n);
  const opponent = async () => {
    const seated = await until(() => single(db.from('games').select('white').eq('id', gameId).not('white', 'is', null).maybeSingle()));
    const white = await single(db.from('players').select('name').eq('id', seated.white).single());
    if (white.name !== name) throw new Error(`White is ${white.name}, expected the renamed ${name}`);
    const sync = verifier(peer, gameId, me);
    for (const [count, event] of [
      [0, { kind: 'play', color: 'black', point: at('E5') }],
      [2, { kind: 'play', color: 'black', point: at('J9') }],
      [4, { kind: 'pass', color: 'black' }],
    ]) {
      await until(async () => (await view(sync))?.state.events.length === count);
      await act(sync, event);
    }
    // The phone's second pass carries its guess at dead stones; clear it so the phone's mark is the only one.
    let v = await until(async () => {
      const r = await view(sync);
      return r?.state.events.length === 6 ? r : null;
    });
    if (v.state.game.board[at('J9')] !== 0) throw new Error('J9 was not captured');
    const guessed = new Set(v.state.game.dead);
    while (!v.state.events.slice(6).some((e) => e.color === 'white')) {
      const point = [...v.state.game.dead].find((p) => guessed.has(p));
      if (point === undefined) break;
      const r = await sync.act({ kind: 'mark', color: 'black', point });
      if (!r.ok && r.problem.kind !== 'stale') throw new Error(`Opponent mark refused: ${JSON.stringify(r.problem)}`);
      v = await view(sync);
    }
    const end = await until(async () => {
      const r = await view(sync);
      return r?.row.status === 'over' ? r : null;
    });
    if (end.row.head_hash !== end.state.head) throw new Error('Finished game does not match the verified chain');
    const tail = end.state.events.slice(6).filter((e) => e.color === 'white');
    const kinds = tail.map((e) => e.kind).join(',');
    if (!/^(mark,)+resume,resign$/.test(kinds)) throw new Error(`The phone's last events were ${kinds}`);
    if (!tail.some((e) => e.kind === 'mark' && e.point === at('E5'))) throw new Error('The phone did not mark E5');
    if (end.state.game.result?.winner !== 'black') throw new Error('Black should win by resignation');
  };
  try {
    await Promise.all([run.finished, opponent()]);
  } finally {
    run.flow.kill();
  }
}

/** Keeps the opponent present in Play online until `stop()`; the server takes a touch every 10 s at most. */
function present(peer) {
  const touch = () => void peer.touchPresence().catch(() => {});
  touch();
  const timer = setInterval(touch, 12_000);
  return () => clearInterval(timer);
}

/** The phone's player appears under its welcome name once it joined the family. */
async function phonePlayer(until, name) {
  return until(() => single(db.from('players').select('id').eq('name', name).maybeSingle()));
}

async function endsByResignation(peer, until, gameId) {
  const sync = verifier(peer, gameId, (await peer.me()).id);
  const end = await until(async () => {
    const v = await view(sync);
    return v?.row.status === 'over' ? v : null;
  });
  if (end.row.head_hash !== end.state.head) throw new Error('Finished game does not match the verified chain');
}

/** 08: the phone sees the opponent online, asks them to play, and the game starts when they join. */
async function askAndPlay() {
  const name = `Asker-${Date.now()}`;
  const peer = await opponentPhone();
  const peerId = (await peer.me()).id;
  const until = waiter(STEP_SECONDS);
  const stop = present(peer);
  const run = runFlow('e2e/08-online-ask.yaml', { FIRST_NAME: name, PEER_ID: peerId, EMAIL: phoneEmail('08') });
  const opponent = async () => {
    const player = await phonePlayer(until, name);
    const game = await until(() =>
      single(db.from('games').select('id,invited').eq('created_by', player.id).eq('status', 'open').maybeSingle()),
    );
    if (game.invited !== peerId) throw new Error('The ask was not addressed to the opponent');
    await peer.joinGame(game.id);
    await endsByResignation(peer, until, game.id);
  };
  try {
    await Promise.all([run.finished, opponent()]);
  } finally {
    stop();
    run.flow.kill();
  }
}

/** 09: the opponent asks the phone to play; the ask shows in Play online and Join starts the game. */
async function askedToPlay() {
  const name = `Asked-${Date.now()}`;
  const peer = await opponentPhone();
  const until = waiter(STEP_SECONDS);
  const run = runFlow('e2e/09-online-asked.yaml', { FIRST_NAME: name, EMAIL: phoneEmail('09') });
  const opponent = async () => {
    const player = await phonePlayer(until, name);
    const gameId = await peer.askToPlay(player.id, 9, 'black');
    await until(() => single(db.from('games').select('id').eq('id', gameId).eq('status', 'playing').maybeSingle()));
    await endsByResignation(peer, until, gameId);
  };
  try {
    await Promise.all([run.finished, opponent()]);
  } finally {
    run.flow.kill();
  }
}

const adb = join(process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`, 'platform-tools/adb');

/** Waits until the emulator answers and has finished booting. */
async function deviceReady() {
  execFileSync(adb, ['wait-for-device'], { stdio: 'ignore', timeout: 120_000 });
  await waiter(120)(() => {
    try {
      return execFileSync(adb, ['shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' }).trim() === '1';
    } catch {
      return false;
    }
  });
}

async function scenario(play, done) {
  await deviceReady();
  try {
    await play();
  } catch (e) {
    if (!process.env.CI) throw e;
    console.log(`Running again after: ${e.message}`);
    await deviceReady();
    await play();
  }
  console.log(done);
}

try {
  await scenario(createAndFinish, '06: the phone created a game, finished it with the API peer, and sent feedback with game context.');
  await scenario(joinAndResign, '07: the phone joined a family game, captured, reopened it, marked, kept playing and resigned.');
  await scenario(askAndPlay, '08: the phone saw the opponent online, asked them to play, and the game started when they joined.');
  await scenario(askedToPlay, '09: the opponent asked the phone to play, and Join started the game.');
  recordPass('online');
} finally {
  for (const c of clients) await c.realtime.disconnect();
}
