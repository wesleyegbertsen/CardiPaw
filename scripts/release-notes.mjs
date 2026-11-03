// Prints the list for the release notes' "What's changed": one line per first-parent commit in
// <range>, with the "Release notes" section of its PR's description quoted under it.
// The release (release.yml) runs it; CI (ci.yml) checks that it runs from outside the repo.
// Node built-ins only: the release job installs no npm dependencies.
// Usage:
//   node scripts/release-notes.mjs <range>
//       env: GITHUB_REPOSITORY (owner/name), GH_TOKEN (pull-requests: read),
//            GITHUB_STEP_SUMMARY (optional, gets the warnings)
// A PR that can't be read, isn't the commit's merge, or was edited after it was merged keeps its
// line and gets a warning on stderr; only bad usage or a git failure exits non-zero.

import { execFileSync, spawnSync } from 'child_process';
import { appendFileSync } from 'fs';
import {
  buildChangelog,
  GIT_LOG_FORMAT,
  parseGitLog,
  PR_QUERY,
  warningCommand,
  warningsSummary,
} from './release-notes-lib.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;

// A PR or repository that doesn't exist makes gh exit 1 with "gh: Could not resolve to …".
function fetchPr(repo, number) {
  const [owner, name] = repo.split('/');
  const result = spawnSync(
    'gh',
    [
      'api',
      'graphql',
      '-f',
      `query=${PR_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `number=${number}`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER },
  );
  if (result.error) return { error: `gh could not run: ${result.error.message}` };
  if (result.status !== 0) {
    const reason = result.stderr.trim().split('\n')[0] || `signal ${result.signal}`;
    return { error: `gh api graphql failed (exit ${result.status}): ${reason}` };
  }
  return { json: result.stdout };
}

function main(range) {
  const repo = process.env.GITHUB_REPOSITORY;
  const log = execFileSync(
    'git',
    ['log', '--first-parent', `--format=${GIT_LOG_FORMAT}`, '--end-of-options', range],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: MAX_BUFFER },
  );
  const { markdown, warnings } = buildChangelog(parseGitLog(log), (number) =>
    fetchPr(repo, number),
  );
  for (const warning of warnings) console.error(warningCommand(warning));
  if (warnings.length && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, warningsSummary(warnings));
  }
  process.stdout.write(markdown);
}

const args = process.argv.slice(2);
if (args.length !== 1 || !/^[^/]+\/[^/]+$/.test(process.env.GITHUB_REPOSITORY ?? '')) {
  console.error(
    'Usage: node scripts/release-notes.mjs <range>\n' +
      '       env: GITHUB_REPOSITORY (owner/name), GH_TOKEN, GITHUB_STEP_SUMMARY (optional)',
  );
  process.exit(1);
}
try {
  main(args[0]);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
