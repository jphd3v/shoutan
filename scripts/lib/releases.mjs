// Which issues a release contains: every "Refs #n" in the commits since the previous
// release of the same channel.
import { execFileSync } from 'node:child_process';

export const TAG = { dev: /^shoutan-dev-\d+$/, prod: /^shoutan-\d+\.\d+\.\d+-\d+$/ };

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

/** The newest tag of the channel that is an ancestor of `ref`, excluding `ref` itself. */
export function previousTag(channel, ref = 'HEAD', cwd = '.') {
  const head = git(cwd, 'rev-parse', `${ref}^{commit}`);
  const tags = git(cwd, 'tag', '--list')
    .split('\n')
    .filter((t) => TAG[channel].test(t))
    .filter((t) => {
      const c = git(cwd, 'rev-parse', `${t}^{commit}`);
      if (c === head) return false;
      try {
        git(cwd, 'merge-base', '--is-ancestor', c, head);
        return true;
      } catch {
        return false;
      }
    });
  return tags.sort((a, b) => Number(git(cwd, 'rev-list', '--count', b)) - Number(git(cwd, 'rev-list', '--count', a)))[0] ?? null;
}

export const referencedIssues = (text) =>
  [...new Set([...text.matchAll(/\bRefs #(\d+)\b/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);

export function issuesInRelease(channel, ref = 'HEAD', cwd = '.') {
  const prev = previousTag(channel, ref, cwd);
  return referencedIssues(git(cwd, 'log', '--format=%B', prev ? `${prev}..${ref}` : ref));
}

/**
 * Markdown notes for a release: the subject of every commit since the previous release of the
 * same channel, newest first, and the issues those commits refer to or close.
 */
export function releaseNotes(channel, ref = 'HEAD', cwd = '.') {
  const prev = previousTag(channel, ref, cwd);
  const range = prev ? `${prev}..${ref}` : ref;
  const subjects = git(cwd, 'log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean);
  const bodies = git(cwd, 'log', '--format=%B', range);
  const issues = [...new Set([...bodies.matchAll(/\b(?:refs|closes|fixes)\s+#(\d+)\b/gi)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return [
    prev ? `Changes since ${prev}:` : 'Changes:',
    '',
    ...subjects.map((s) => `- ${s}`),
    ...(issues.length ? ['', `Issues: ${issues.map((n) => `#${n}`).join(', ')}`] : []),
  ].join('\n');
}
