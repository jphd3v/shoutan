// The few GitHub REST calls the report sync and the releases need. `fetchImpl` lets tests stand in for GitHub.
import { execFileSync } from 'node:child_process';

const API = 'https://api.github.com';

/** The workflow's own credential in CI; run locally, the maintainer's gh login. */
export function githubToken() {
  return process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
}

/** owner/name from GITHUB_REPOSITORY (CI) or the origin remote. */
export function githubRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return repoFromUrl(execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim());
}

/** owner/name from a GitHub remote URL, including SSH host aliases such as `git@github.com-work:owner/name.git`. */
export function repoFromUrl(url) {
  const m = url.match(/^(?:https:\/\/github\.com\/|(?:ssh:\/\/)?git@github\.com(?:-[\w.-]+)?[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`origin is not a GitHub repository: ${url}`);
  return m[1];
}

export function github({ token, repo, fetchImpl = fetch }) {
  async function call(method, path, body) {
    const r = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }
  const issues = `/repos/${repo}/issues`;
  return {
    repo,
    getIssue: (n) => call('GET', `${issues}/${n}`),
    listIssues: (query) => call('GET', `${issues}?${new URLSearchParams(query)}`),
    createIssue: (issue) => call('POST', issues, issue),
    comment: (n, body) => call('POST', `${issues}/${n}/comments`, { body }),
    close: (n) => call('PATCH', `${issues}/${n}`, { state: 'closed', state_reason: 'completed' }),
    addLabels: (n, labels) => call('POST', `${issues}/${n}/labels`, { labels }),
  };
}
