#!/usr/bin/env node
// From a fresh clone to a verified local build: `npm run setup`.
// Checks the tools, installs Maestro and the dependencies, starts the local Supabase stack
// and runs the full verification. Uses only Node built-ins, so it runs before `npm ci`.
// The owner's hosting setup is separate: npm run infra (docs/releasing.md).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const problems = [];
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

const wantedNode = readFileSync('.nvmrc', 'utf8').trim();
if (process.versions.node !== wantedNode)
  problems.push(`Node ${wantedNode} is required (found ${process.versions.node}): run \`nvm install && nvm use\`.`);
if (!has('docker', ['info'])) problems.push('Docker must be running for the local Supabase stack (for example `colima start`).');
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const optional = [
  [process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME), 'ANDROID_HOME is not set: needed for APK builds and emulator tests.'],
  [has('java', ['-version']), 'Java 21 is not on PATH: needed for APK builds (set JAVA_HOME to a JDK 21).'],
];
for (const [ok, message] of optional) if (!ok) console.warn(`! ${message}`);

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
run(process.execPath, ['scripts/install-maestro.mjs']);
run('npm', ['ci']);
run('npx', ['supabase', 'start']);
run('npm', ['run', 'verify']);

console.log(`
✓ Verified. Next:
  npm run build:local                       APK for the emulator, against the local stack
  adb install -r dist/shoutan-local-*.apk
  npm run test:offline && npm run test:online
Hosting, signing and GitHub releases: npm run infra (docs/releasing.md).`);
