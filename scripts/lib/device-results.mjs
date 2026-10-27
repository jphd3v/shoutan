// Records passing emulator suites per commit, so publishing can require that the exact
// commit was tested on a device with an APK built from it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'e2e-output/device-results.json';
const APP_ID = 'io.github.jphd3v.shoutan.local';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const adbPath = () =>
  process.env.GO_ADB ?? join(process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`, 'platform-tools/adb');
const adb = (...a) => execFileSync(adbPath(), a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * The manifest of the local build installed on the emulator, found by the APK's checksum: the
 * newest build may never have been installed. Null when no build in `dist/` matches.
 */
function installedBuild() {
  let installed;
  try {
    const path = adb('shell', 'pm', 'path', APP_ID)
      .split('\n')[0]
      .replace(/^package:/, '');
    installed = adb('shell', 'sha256sum', path).split(/\s/)[0];
  } catch {
    return null;
  }
  if (!existsSync('dist')) return null;
  for (const f of readdirSync('dist').filter((f) => f.startsWith('shoutan-local-') && f.endsWith('.apk'))) {
    const apk = `dist/${f}`;
    if (createHash('sha256').update(readFileSync(apk)).digest('hex') === installed && existsSync(`${apk}.json`))
      return JSON.parse(readFileSync(`${apk}.json`, 'utf8'));
  }
  return null;
}

const read = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {});

export function recordPass(suite) {
  const results = read();
  results[suite] = {
    commit: git('rev-parse', 'HEAD'),
    clean: git('status', '--porcelain') === '',
    apkCommit: installedBuild()?.commit ?? null,
    at: new Date().toISOString(),
  };
  mkdirSync('e2e-output', { recursive: true });
  writeFileSync(FILE, JSON.stringify(results, null, 2) + '\n');
}

/** Problems that prevent treating `commit` as device-tested by every suite. */
export function deviceProblems(commit, suites = ['offline', 'online']) {
  const results = read();
  return suites.flatMap((suite) => {
    const r = results[suite];
    if (!r || r.commit !== commit) return [`${suite} device tests have not passed on ${commit.slice(0, 12)}`];
    if (!r.clean) return [`${suite} device tests ran with uncommitted changes`];
    if (r.apkCommit !== commit)
      return [`${suite} device tests ran on an APK built from ${String(r.apkCommit).slice(0, 12)}, not ${commit.slice(0, 12)}`];
    return [];
  });
}
