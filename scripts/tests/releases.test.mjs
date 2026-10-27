import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { issuesInRelease, previousTag, referencedIssues, releaseNotes } from '../lib/releases.mjs';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'releases-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'a@b.c');
  git(dir, 'config', 'user.name', 'A');
  let n = 0;
  const commit = (message) => {
    writeFileSync(join(dir, 'f'), String(n++));
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', message);
  };
  return { dir, commit, tag: (t) => git(dir, 'tag', t) };
}

describe('release issues', () => {
  it('reads each referenced issue once', () => {
    assert.deepEqual(referencedIssues('Fix\n\nRefs #12\nRefs #3, Refs #12\nnot #99, XRefs #5'), [3, 12]);
  });

  it('collects the issues since the previous release of the same channel', () => {
    const r = repo();
    r.commit('Start');
    r.commit('One\n\nRefs #1');
    r.tag('shoutan-dev-2');
    r.tag('shoutan-1.0.0-2');
    r.commit('Two\n\nRefs #2');
    r.tag('shoutan-dev-3');
    r.commit('Three\n\nRefs #3');
    r.tag('shoutan-dev-4');
    assert.equal(previousTag('dev', 'HEAD', r.dir), 'shoutan-dev-3');
    assert.deepEqual(issuesInRelease('dev', 'HEAD', r.dir), [3]);
    assert.equal(previousTag('prod', 'HEAD', r.dir), 'shoutan-1.0.0-2');
    assert.deepEqual(issuesInRelease('prod', 'HEAD', r.dir), [2, 3]);
  });

  it('a first release covers the whole history', () => {
    const r = repo();
    r.commit('One\n\nRefs #1');
    r.commit('Two\n\nRefs #2');
    assert.equal(previousTag('prod', 'HEAD', r.dir), null);
    assert.deepEqual(issuesInRelease('prod', 'HEAD', r.dir), [1, 2]);
  });

  it('writes release notes from the commits since the previous release, with their issues', () => {
    const r = repo();
    r.commit('Start');
    r.tag('shoutan-dev-1');
    r.commit('Show a legend while counting\n\nCloses #4');
    r.commit('Handicap online\n\nRefs #8, refs #9');
    assert.equal(
      releaseNotes('dev', 'HEAD', r.dir),
      ['Changes since shoutan-dev-1:', '', '- Handicap online', '- Show a legend while counting', '', 'Issues: #4, #8, #9'].join('\n'),
    );
  });

  it('notes for a first release list every commit, and leave out issues when there are none', () => {
    const r = repo();
    r.commit('Start');
    assert.equal(releaseNotes('prod', 'HEAD', r.dir), ['Changes:', '', '- Start'].join('\n'));
  });
});
