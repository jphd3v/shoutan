import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { repoFromUrl } from '../lib/github.mjs';

describe('GitHub remote', () => {
  it('reads owner/name from HTTPS, SSH and SSH host-alias remotes', () => {
    assert.equal(repoFromUrl('https://github.com/jphd3v/go.git'), 'jphd3v/go');
    assert.equal(repoFromUrl('https://github.com/jphd3v/go'), 'jphd3v/go');
    assert.equal(repoFromUrl('git@github.com:jphd3v/go.git'), 'jphd3v/go');
    assert.equal(repoFromUrl('git@github.com-jphd3v:jphd3v/go.git'), 'jphd3v/go');
    assert.equal(repoFromUrl('ssh://git@github.com/jphd3v/go.git'), 'jphd3v/go');
  });

  it('refuses remotes that are not GitHub', () => {
    assert.throws(() => repoFromUrl('https://gitlab.com/jphd3v/go.git'), /not a GitHub repository/);
    assert.throws(() => repoFromUrl('https://github.com.evil.example/jphd3v/go.git'), /not a GitHub repository/);
    assert.throws(() => repoFromUrl('/tmp/remote.git'), /not a GitHub repository/);
  });
});
