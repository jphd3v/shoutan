#!/usr/bin/env node
// Tells the issues in a release where they are: `node scripts/release-issues.mjs dev|prod <tag>`.
// Shoutan Dev releases comment on each issue; prod releases comment and close it. Run by the
// release workflows with GITHUB_TOKEN.
import { github, githubRepo, githubToken } from './lib/github.mjs';
import { issuesInRelease, TAG } from './lib/releases.mjs';

const [channel, tag] = process.argv.slice(2);
if (!TAG[channel] || !TAG[channel].test(tag ?? '')) throw new Error('Usage: release-issues.mjs dev|prod <tag of that channel>');

const gh = github({ token: githubToken(), repo: githubRepo() });
const repo = githubRepo();
for (const n of issuesInRelease(channel)) {
  const issue = await gh.getIssue(n);
  if (issue.pull_request || issue.state !== 'open') continue;
  const link = `[${tag}](https://github.com/${repo}/releases/tag/${tag})`;
  if (channel === 'dev') {
    await gh.comment(n, `Available for testing in Shoutan Dev ${link}.`);
  } else {
    await gh.comment(n, `Released to the family in ${link}.`);
    await gh.close(n);
  }
  console.log(`#${n}: ${channel === 'dev' ? 'commented' : 'closed'}`);
}
