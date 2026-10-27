#!/usr/bin/env node
// Runs the emulator flows in airplane mode, once, and restores networking afterwards.
// Default: the smoke flow, a couple of minutes. `--full`: the offline release flows `e2e/01`–`05`.
// On CI a flow that failed runs once more on its own: the runner's emulator, fresh from booting, has
// lost a flow at its first steps, where a real failure fails again.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { recordPass } from './lib/device-results.mjs';
import { maestroBin, maestroEnv } from './lib/maestro.mjs';
import { withLog } from './lib/quiet.mjs';

const full = process.argv.includes('--full');
const adb = join(process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`, 'platform-tools/adb');
const shell = (...args) => execFileSync(adb, ['shell', ...args], { stdio: 'inherit' });
const flows = full
  ? readdirSync('e2e')
      .filter((f) => /^0[1-5]-.*\.yaml$/.test(f))
      .sort()
      .map((f) => `e2e/${f}`)
  : ['e2e/smoke.yaml'];
/** The flows the JUnit report marks as failed; none when there is no report to say which. */
function failedFlows(report) {
  if (!existsSync(report)) return [];
  const failed = readFileSync(report, 'utf8')
    .split('<testcase')
    .slice(1)
    .filter((testcase) => /<(failure|error)\b/.test(testcase.split('</testcase>')[0]))
    .map((testcase) => /\bname="([^"]+)"/.exec(testcase)?.[1]);
  return flows.filter((f) => failed.includes(basename(f, '.yaml')));
}

try {
  shell('cmd', 'connectivity', 'airplane-mode', 'enable');
  shell('svc', 'wifi', 'disable');
  shell('svc', 'data', 'disable');
  const out = `e2e-output/${full ? 'full' : 'smoke'}`;
  const run = (files, dir) =>
    withLog(`${dir}.log`, (stdio) =>
      execFileSync(
        maestroBin,
        [
          'test',
          '-e',
          'APP_ID=io.github.jphd3v.shoutan.local',
          '--format',
          'JUNIT',
          '--output',
          `${dir}.xml`,
          '--test-output-dir',
          dir,
          ...files,
        ],
        { stdio, env: maestroEnv },
      ),
    );
  try {
    run(flows, out);
  } catch (e) {
    const failed = process.env.CI ? failedFlows(`${out}.xml`) : [];
    if (failed.length === 0) throw e;
    console.log(`Running again: ${failed.map((f) => basename(f, '.yaml')).join(', ')}`);
    run(failed, `${out}-again`);
  }
  recordPass('offline');
} finally {
  shell('cmd', 'connectivity', 'airplane-mode', 'disable');
  shell('svc', 'wifi', 'enable');
  shell('svc', 'data', 'enable');
}
