import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { deviceProblems, recordPass } from '../lib/device-results.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

/** A repository with two local builds in dist/ and an emulator (a fake adb) that has `installed` on it. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'device-results-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'factory@example.com');
  git(root, 'config', 'user.name', 'Factory');
  writeFileSync(join(root, '.gitignore'), 'dist/\ne2e-output/\nadb\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'Old');
  const old = git(root, 'rev-parse', 'HEAD');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'New');
  const now = git(root, 'rev-parse', 'HEAD');
  mkdirSync(join(root, 'dist'));
  for (const [code, commit] of [
    [1, old],
    [2, now],
  ]) {
    writeFileSync(join(root, `dist/shoutan-local-1.0.0-${code}.apk`), `apk built from ${commit}`);
    writeFileSync(join(root, `dist/shoutan-local-1.0.0-${code}.apk.json`), JSON.stringify({ commit, versionCode: code }));
  }
  const adb = join(root, 'adb');
  const install = (code) => {
    const sha = createHash('sha256')
      .update(readFileSync(join(root, `dist/shoutan-local-1.0.0-${code}.apk`)))
      .digest('hex');
    writeFileSync(adb, `#!/bin/sh\ncase "$3" in path) echo "package:/data/app/base.apk";; *) echo "${sha}  /data/app/base.apk";; esac\n`);
    chmodSync(adb, 0o755);
  };
  return { root, old, now, adb, install };
}

function inside(w, work) {
  const before = process.cwd();
  const adb = process.env.GO_ADB;
  process.chdir(w.root);
  process.env.GO_ADB = w.adb;
  try {
    return work();
  } finally {
    process.chdir(before);
    if (adb === undefined) delete process.env.GO_ADB;
    else process.env.GO_ADB = adb;
  }
}

describe('device results', () => {
  it('a suite run on an older installed APK does not count for the newest build', () => {
    const w = workspace();
    w.install(1);
    const problems = inside(w, () => {
      recordPass('offline');
      return deviceProblems(w.now, ['offline']);
    });
    assert.deepEqual(problems, [`offline device tests ran on an APK built from ${w.old.slice(0, 12)}, not ${w.now.slice(0, 12)}`]);
  });

  it('a suite run on the installed build of this commit counts', () => {
    const w = workspace();
    w.install(2);
    assert.deepEqual(
      inside(w, () => {
        recordPass('offline');
        return deviceProblems(w.now, ['offline']);
      }),
      [],
    );
  });
});
