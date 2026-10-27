#!/usr/bin/env node
/**
 * Adds the source of a private commit to the `public` branch as one commit, the way the public
 * repository receives it: without the private repository's automation and agent settings, and
 * authored by the owner's public identity. Run by the owner from a clean working tree:
 *
 *   npm run publish:public -- --dry-run     list what would be published and check it, change nothing
 *   npm run publish:public                  commit it onto `public` (pushing stays a separate step)
 *
 * Agents may run the dry run; publishing is the owner's step, after reading it.
 * Names and addresses that must never be published, such as the owner's full name or employer, come
 * from `git config shoutan.privateTerms` (comma-separated), so they stay out of the source too.
 * The public identity comes from `git config shoutan.publicAuthor` ("Name <id+username@users.noreply.github.com>").
 * The commit is built with git's plumbing from the private commit's tree, so no files are written.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRANCH = 'public';
/** Paths that stay in the private repository: its automation, the release tooling only it runs, agent settings, and the agents' push rules, which name the private remotes. */
const PRIVATE = ['.github/', '.claude/', 'fastlane/', 'Gemfile', 'Gemfile.lock', '.husky/pre-push'];
/** Text that must never leave the private repository. */
const FORBIDDEN = [
  [/sb_secret_[\w-]{8,}/, 'a Supabase secret key'],
  [/sb_publishable_(?!test\b)[\w-]{8,}/, 'a real Supabase publishable key'],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/, 'a JSON web token'],
  [/\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}|github_pat_\w{20,}/, 'a GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'an AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/[a-z0-9]{20}\.supabase\.co/, 'a hosted Supabase address'],
  // Joined here so this file, which is published, doesn't hold the name itself.
  [new RegExp(['shoutan', 'private'].join('-')), 'the private repository’s name'],
];
/** E-mail addresses that may appear: GitHub's no-reply addresses, placeholders and test domains. */
const ALLOWED_EMAIL = /^git@|@(users\.noreply\.github\.com|example\.(com|org|net|test)|email\.com)$/;
/** An address with a real-looking domain; versions (`npm@12.2.0`) and test values (`a@b.c`) are not. */
const EMAIL = /[\w.+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;

const dryRun = process.argv.includes('--dry-run');
const agent = process.env.CLAUDECODE || process.env.CODEX_SANDBOX || process.env.CODEX_SANDBOX_NETWORK_DISABLED || process.env.GO_AGENT;
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const tryGit = (args) => {
  try {
    return git(args, { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const stop = (problems) => {
  console.error(`Not published:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
};

if (!dryRun && agent) stop(['publishing is the owner’s step: run it yourself after reading the dry run']);
if (!dryRun && git(['status', '--porcelain', '--untracked-files=no']).trim()) stop(['commit or stash your changes first']);
const source = git(['rev-parse', 'HEAD']).trim();
const entries = git(['ls-tree', '-r', '-z', '--full-tree', source])
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const [meta, path] = line.split('\t');
    const [mode, type, hash] = meta.split(' ');
    return { mode, type, hash, path };
  });
const published = entries.filter((e) => !PRIVATE.some((p) => e.path.startsWith(p)));
const left = entries.length - published.length;

const privateTerms = tryGit(['config', 'shoutan.privateTerms'])
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);
for (const term of privateTerms)
  FORBIDDEN.push([new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'a private name or address']);

const problems = [];
const emails = new Set();
for (const e of published) {
  if (e.type !== 'blob') continue;
  if (/(^|\/)\.env(\.|$)/.test(e.path)) problems.push(`${e.path}: an environment file`);
  const buf = execFileSync('git', ['cat-file', 'blob', e.hash], { maxBuffer: 1 << 28 });
  if (buf.includes(0)) continue;
  const text = buf.toString('utf8');
  for (const [pattern, what] of FORBIDDEN) if (pattern.test(text)) problems.push(`${e.path}: ${what}`);
  // The lockfile names package authors, as published on npm.
  if (e.path === 'package-lock.json') continue;
  for (const m of text.matchAll(EMAIL)) if (!ALLOWED_EMAIL.test(m[0])) emails.add(`${e.path}: ${m[0]}`);
}
for (const e of emails) problems.push(`${e} (an e-mail address)`);

const author = tryGit(['config', 'shoutan.publicAuthor']);
const who = author.match(/^(.+?) <([^>]+@users\.noreply\.github\.com)>$/);
if (!who)
  problems.push(
    'set git config shoutan.publicAuthor "Name <id+username@users.noreply.github.com>" (your public name and GitHub no-reply address)',
  );

const tip = tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]);
const top = (p) => (p.includes('/') ? `${p.split('/')[0]}/` : p);
const summary = [...new Set(published.map((e) => top(e.path)))].sort();
console.log(
  `From ${source.slice(0, 12)}: ${published.length} files published, ${left} kept private (${PRIVATE.join(', ')}).\n` +
    `Published: ${summary.join(' ')}\n` +
    `Branch ${BRANCH}: ${tip ? `adds a commit after ${tip.slice(0, 12)}` : 'starts with this commit'}.`,
);
if (problems.length) stop(problems);
if (dryRun) {
  console.log('Dry run: the checks passed and nothing was changed.');
  process.exit(0);
}

// The tree through a scratch index, so the working tree and the real index stay as they are.
const index = join(mkdtempSync(join(tmpdir(), 'publish-')), 'index');
const env = { ...process.env, GIT_INDEX_FILE: index };
git(['read-tree', '--empty'], { env });
git(['update-index', '--index-info'], { env, input: published.map((e) => `${e.mode} ${e.hash}\t${e.path}`).join('\n') + '\n' });
const tree = git(['write-tree'], { env }).trim();
if (tip && git(['rev-parse', `${tip}^{tree}`]).trim() === tree) {
  console.log(`Nothing new: ${BRANCH} already holds this source.`);
  process.exit(0);
}
const version = JSON.parse(git(['show', `${source}:package.json`])).version;
const message = `Shoutan ${version}\n\nSource of ${source.slice(0, 12)}.\n`;
const messageFile = join(index, '..', 'message');
writeFileSync(messageFile, message);
const [, name, email] = who;
const commit = git(['commit-tree', tree, ...(tip ? ['-p', tip] : []), '-F', messageFile], {
  env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email },
}).trim();
git(['update-ref', `refs/heads/${BRANCH}`, commit, ...(tip ? [tip] : [])]);
console.log(`Committed ${commit.slice(0, 12)} on ${BRANCH}. Push it yourself: git push public ${BRANCH}:main`);
