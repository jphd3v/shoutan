#!/usr/bin/env node
// Fails when a change lowers the quality bar instead of meeting it: new lint or type
// suppressions, skipped or focused tests, unfinished-work markers, deleted tests (a unit
// test may go together with the module it tests, `x/__tests__/a.test.ts` with `x/a.ts`),
// lowered coverage thresholds, edited migrations or destructive migrations.
//
// Compares the working tree (including uncommitted changes) with GUARD_BASE, or with
// the merge base of HEAD and main. `--staged` checks only the staged diff.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return '';
  }
};

const staged = process.argv.includes('--staged');
const mainRef = tryGit('rev-parse', '--verify', '--quiet', 'origin/main') ? 'origin/main' : 'main';
const base = process.env.GUARD_BASE || tryGit('merge-base', 'HEAD', mainRef) || 'HEAD';
const range = staged ? ['--cached'] : [base];
const root = git('rev-parse', '--show-prefix'); // "" at the repository root
const scope = ['--', '.', ':!package-lock.json', ':!tools/anti-slop', ':!scripts/check-guards.mjs'];

const problems = [];

const addedLines = [];
let file = '';
for (const line of git('diff', '--unified=0', '--no-color', ...range, ...scope).split('\n')) {
  if (line.startsWith('+++ ')) file = line.slice(6);
  else if (line.startsWith('+') && !line.startsWith('+++')) addedLines.push({ file, text: line.slice(1) });
}

const banned = [
  [/eslint-disable|oxlint-disable/, 'lint suppression'],
  [/@ts-(ignore|expect-error|nocheck)/, 'type-check suppression'],
  [/\b(it|test|describe)\.(skip|only|todo)\b|\bx(it|describe|test)\(|\bf(it|describe)\(/, 'skipped or focused test'],
  [/^\s*-\s*(skip|optional)\s*:\s*true/, 'skipped Maestro step'],
  [/\b(TODO|FIXME|XXX|HACK)\b/, 'unfinished-work marker'],
  [/not implemented|unimplemented/i, 'unimplemented stub'],
];
for (const { file: f, text } of addedLines) {
  for (const [re, what] of banned) if (re.test(text)) problems.push(`${f}: added ${what}: ${text.trim()}`);
}

const nameStatus = git('diff', '--name-status', '--no-renames', ...range, ...scope)
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'));
const relative = (path) => (path.startsWith(root) ? path.slice(root.length) : path);
const deleted = new Set(nameStatus.filter(([status]) => status === 'D').map(([, path]) => relative(path)));
/** The module a unit test covers, `x/__tests__/a.test.ts` → `x/a.ts` or `x/a.tsx`. */
const testedModule = (p) => {
  const m = /^(.*\/)__tests__\/([^/]+)\.test\.tsx?$/.exec(p);
  return m ? [`${m[1]}${m[2]}.ts`, `${m[1]}${m[2]}.tsx`] : [];
};
for (const [status, path] of nameStatus) {
  const p = relative(path);
  if (
    status === 'D' &&
    /(__tests__\/|\.test\.tsx?$|^e2e\/.*\.yaml$|^supabase\/tests\/)/.test(p) &&
    !testedModule(p).some((m) => deleted.has(m))
  )
    problems.push(`${p}: test deleted`);
  if (status !== 'A' && /^supabase\/migrations\//.test(p)) {
    problems.push(`${p}: an existing migration was changed; add a new migration instead`);
  }
  if (status === 'A' && /^supabase\/migrations\/.*\.sql$/.test(p)) problems.push(...migrationRisks(p, readFileSync(p, 'utf8')));
}

/**
 * Statements in a new migration that can break app versions still installed on phones: removing
 * or renaming, new constraints on existing data, data rewrites, revoking from phones, and
 * replacing a function an earlier migration defined. Function bodies are not scanned for
 * statements; a replaced function is flagged by its name.
 */
function migrationRisks(p, sql) {
  const risky = new RegExp(
    [
      String.raw`\bdrop\s+(table|column|function|type|constraint|policy|view|schema)\b`,
      String.raw`\brename\s+(to|column)\b`,
      String.raw`\balter\s+column\s+\S+\s+(set\s+data\s+)?type\b`,
      String.raw`\bset\s+not\s+null\b`,
      String.raw`\badd\s+(constraint|unique|primary\s+key|check|foreign\s+key)\b`,
      String.raw`\bcreate\s+unique\s+index\b`,
      String.raw`\brevoke\b.*\bauthenticated\b`,
      String.raw`^\s*(update|delete\s+from|truncate)\b`,
    ].join('|'),
    'i',
  );
  const earlier = readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql') && `supabase/migrations/${f}` !== p)
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
    .join('\n');
  const definedBefore = (name) => new RegExp(String.raw`create\s+(or\s+replace\s+)?function\s+public\.${name}\s*\(`, 'i').test(earlier);
  const found = [];
  let body = null;
  for (const line of sql.split('\n')) {
    const marked = /(breaking-ok|compatible):/.test(line);
    if (body) {
      if (line.includes(body)) body = null;
      continue;
    }
    const code = line.replace(/--.*$/, '');
    const replaced = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/i.exec(code)?.[1];
    if (!marked && (risky.test(code) || (replaced && definedBefore(replaced))))
      found.push(
        `${p}: "${line.trim()}" can break app versions still installed on phones (after a deliberate decision, mark the line "-- compatible: <why older apps keep working>" or "-- breaking-ok: <reason>")`,
      );
    const opened = /(\$\w*\$)/.exec(code)?.[1];
    if (opened && code.split(opened).length === 2) body = opened;
  }
  return found;
}

const thresholds = (json) => JSON.parse(json).jest?.coverageThreshold ?? {};
const before = tryGit('show', `${staged ? 'HEAD' : base}:./package.json`);
if (before) {
  const now = staged ? git('show', ':./package.json') : readFileSync('package.json', 'utf8');
  const old = thresholds(before);
  const cur = thresholds(now);
  for (const [key, metrics] of Object.entries(old)) {
    for (const [metric, value] of Object.entries(metrics)) {
      const next = cur[key]?.[metric];
      if (next === undefined || next < value)
        problems.push(`package.json: coverage threshold ${key}.${metric} lowered from ${value} to ${next ?? 'nothing'}`);
    }
  }
}

if (problems.length) {
  console.error(`Quality guard failed (compared with ${staged ? 'the staged diff' : base.slice(0, 12)}):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('Fix the cause instead of lowering the bar. If a rule itself is wrong, ask the owner to change this script.');
  process.exit(1);
}
console.log('Quality guard passed.');
