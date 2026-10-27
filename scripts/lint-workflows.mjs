#!/usr/bin/env node
// Runs actionlint (with shellcheck) on every GitHub workflow. Each file goes in on stdin,
// because Docker on macOS (colima) shares only the home folder, so mounting a checkout
// elsewhere would hand actionlint an empty directory.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const dir = '.github/workflows';
let failed = false;
for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
  const r = spawnSync(
    'docker',
    ['run', '--rm', '-i', 'rhysd/actionlint:1.7.7', '-no-color', '-stdin-filename', `.github/workflows/${f}`, '-'],
    {
      input: readFileSync(`${dir}/${f}`),
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );
  failed ||= r.status !== 0;
}
if (failed) process.exit(1);
console.log('Workflows pass actionlint.');
