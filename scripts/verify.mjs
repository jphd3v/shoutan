#!/usr/bin/env node
// Runs every check in order. The database tests need Docker and the local Supabase stack and
// take most of the time, so on a laptop they run only when something they test has changed
// since main; CI runs `--all` on every push, so nothing reaches main untested.
import { execFileSync } from 'node:child_process';

const all = process.argv.includes('--all');
const git = (...a) => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

/** Files changed since main: commits not on main, uncommitted edits and new files. */
function changedFiles() {
  const main = process.env.GUARD_BASE ?? (git('rev-parse', '--verify', '--quiet', 'origin/main') ? 'origin/main' : 'main');
  const base = git('merge-base', 'HEAD', main);
  if (base === null) return null;
  const lists = [git('diff', '--name-only', base), git('ls-files', '--others', '--exclude-standard')];
  if (lists.includes(null)) return null;
  return lists.join('\n').split('\n').filter(Boolean);
}

/** What the database tests exercise: migrations, the hosted install, and the code that talks to them. */
const DATABASE = /^(supabase\/|src\/net\/|src\/online\/|scripts\/(test-db|test-schema|schema-sql)\.mjs|scripts\/lib\/schema\.mjs)/;

const steps = ['guard', 'format:check', 'lint', 'lint:workflows', 'typecheck', 'test:coverage', 'test:scripts'];
const changed = all ? null : changedFiles();
const database = all || changed === null || changed.some((f) => DATABASE.test(f));
if (database) steps.push('test:db', 'test:schema');

for (const step of steps) execFileSync('npm', ['run', step], { stdio: 'inherit' });
if (!database) console.log('Database tests skipped: nothing they test changed since main. CI runs them on every push.');
