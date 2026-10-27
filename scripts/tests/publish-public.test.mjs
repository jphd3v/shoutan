import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const script = resolve('scripts/publish-public.mjs');
const AUTHOR = 'Owner <1+owner@users.noreply.github.com>';

/** A private repository with one commit of `files`. */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'owner@example.com');
  git('config', 'user.name', 'Owner');
  git('config', 'shoutan.publicAuthor', AUTHOR);
  git('config', 'shoutan.privateTerms', 'Jane Q Owner, acme-corp');
  for (const [path, text] of Object.entries({ 'package.json': '{"version":"1.0.0"}', ...files })) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'private work');
  return { dir, git };
}
const owner = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !['CLAUDECODE', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'GO_AGENT'].includes(k)),
);
const publish = (dir, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: owner });

describe('publishing the source', () => {
  it('commits the source without the private automation, as the public author, one commit per publish', () => {
    const { dir, git } = repo({
      'src/a.ts': 'export const a = 1;\n',
      '.github/workflows/x.yml': 'on: push\n',
      '.claude/settings.json': '{}',
      'fastlane/Fastfile': 'lane :internal do\nend\n',
      Gemfile: "gem 'fastlane'\n",
      'Gemfile.lock': 'GEM\n',
      '.husky/pre-push': 'exit 0\n',
    });
    assert.equal(publish(dir).status, 0);
    assert.deepEqual(git('ls-tree', '-r', '--name-only', 'public').split('\n'), ['package.json', 'src/a.ts']);
    assert.equal(git('log', '-1', '--format=%an <%ae>|%cn <%ce>', 'public'), `${AUTHOR}|${AUTHOR}`);
    writeFileSync(join(dir, 'src/a.ts'), 'export const a = 2;\n');
    git('commit', '-qam', 'more private work');
    git('commit', '-q', '--allow-empty', '-m', 'and more');
    assert.equal(publish(dir).status, 0);
    assert.equal(git('rev-list', '--count', 'public'), '2');
    assert.match(publish(dir).stdout, /Nothing new/);
  });

  it('refuses secrets, environment files and private addresses, and changes nothing', () => {
    for (const files of [
      { 'src/k.ts': `const key = "${'sb_secret'}_abcdefghijklmnop";\n` },
      { '.env.prod.local': 'SUPABASE_URL=x\n' },
      { 'docs/a.md': 'Written by Jane Q. Owner at ACME-Corp\n' },
      // Built from two parts, so this file never holds a private-looking address the real check would refuse.
      { 'docs/b.md': `Mail me at jane.doe@${'acme-corp'}.com\n` },
    ]) {
      const { dir, git } = repo(files);
      const r = publish(dir);
      assert.equal(r.status, 1, Object.keys(files)[0]);
      assert.match(r.stderr, /Not published/);
      assert.equal(git('branch', '--list', 'public'), '');
    }
  });

  it('an agent may run the dry run but not publish', () => {
    const { dir, git } = repo({ 'src/a.ts': 'export {};\n' });
    const asAgent = (...args) =>
      spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: { ...owner, CLAUDECODE: '1' } });
    assert.equal(asAgent('--dry-run').status, 0);
    const r = asAgent();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /owner’s step/);
    assert.equal(git('branch', '--list', 'public'), '');
  });

  it('a dry run changes nothing', () => {
    const { dir, git } = repo({ 'src/a.ts': 'export {};\n' });
    assert.equal(publish(dir, '--dry-run').status, 0);
    assert.equal(git('branch', '--list', 'public'), '');
  });
});
