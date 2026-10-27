#!/usr/bin/env node
// Downloads the pinned Maestro CLI into tools/maestro/ and checks its SHA-256.
// Uses only Node built-ins and `unzip`, so `npm run setup` can run it before `npm ci`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAESTRO_DIR, MAESTRO_SHA256, MAESTRO_URL, MAESTRO_VERSION } from './lib/maestro.mjs';

const stamp = join(MAESTRO_DIR, 'VERSION');
if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === MAESTRO_VERSION) {
  console.log(`Maestro ${MAESTRO_VERSION} is already in ${MAESTRO_DIR}.`);
  process.exit(0);
}

console.log(`Downloading Maestro ${MAESTRO_VERSION}…`);
const res = await fetch(MAESTRO_URL);
if (!res.ok) throw new Error(`${MAESTRO_URL}: HTTP ${res.status}`);
const zip = Buffer.from(await res.arrayBuffer());
const sha = createHash('sha256').update(zip).digest('hex');
if (sha !== MAESTRO_SHA256) throw new Error(`Maestro download has SHA-256 ${sha}, expected ${MAESTRO_SHA256}`);

// Unpack next to the destination so the final rename stays on one filesystem.
const work = mkdtempSync('tools/.maestro-');
try {
  writeFileSync(join(work, 'maestro.zip'), zip);
  execFileSync('unzip', ['-q', join(work, 'maestro.zip'), '-d', work]);
  rmSync(MAESTRO_DIR, { recursive: true, force: true });
  renameSync(join(work, 'maestro'), MAESTRO_DIR);
  writeFileSync(stamp, `${MAESTRO_VERSION}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Installed Maestro ${MAESTRO_VERSION} in ${MAESTRO_DIR}.`);
