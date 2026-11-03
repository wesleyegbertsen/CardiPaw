// Pure parts of scripts/release-notes.mjs. No I/O, so scripts/release-notes-lib.test.mjs
// can test them without git or gh.

// Squash-merge subjects end in "(#123)". Anchored at the end: `Revert "x (#15)" (#16)` is PR 16.
const PR_REF = /\(#(\d+)\)$/;
const COMMIT_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const NOTES_TITLE = /^release notes[ \t]*:?$/i;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** `git log --format=%H%x00%h%x00%s` output → [{ hash, shortHash, subject }]. */
export function parseGitLog(output) {
  return output
    .split('\n')
    .filter((record) => record !== '')
    .map((record) => {
      const fields = record.split('\0');
      if (fields.length !== 3 || !COMMIT_HASH.test(fields[0])) {
        throw new Error(`Unexpected git log record: ${JSON.stringify(record)}`);
      }
      const [hash, shortHash, subject] = fields;
      return { hash, shortHash, subject };
    });
}

/** The PR number a squash-merge subject ends with, or null. */
export function prNumber(subject) {
  const match = PR_REF.exec(subject);
  return match ? Number(match[1]) : null;
}

function parseHeading(line) {
  const match = HEADING.exec(line);
  if (!match) return null;
  // Drop an optional closing sequence: "## Release notes ##".
  const text = (match[2] ?? '').replace(/(?:^|[ \t]+)#+$/, '');
  return { level: match[1].length, text };
}

function openFence(line) {
  const match = FENCE_OPEN.exec(line);
  // "```js`" doesn't open a fence: a backtick fence's info string can't contain a backtick.
  if (!match || (match[1][0] === '`' && match[2].includes('`'))) return null;
  return match[1];
}

function closesFence(line, fence) {
  const match = FENCE_CLOSE.exec(line);
  return !!match && match[1][0] === fence[0] && match[1].length >= fence.length;
}

/**
 * The text under the first "Release notes" heading (any level, outside code fences), up to the
 * next heading of the same or a higher level; null when there is none or it's empty. HTML
 * comments are removed first: GitHub doesn't show them, and the PR template's placeholder is one.
 */
export function extractReleaseNotes(body) {
  const lines = body
    .replace(/\r\n?/g, '\n')
    // An unclosed "<!--" hides the rest of the body.
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .split('\n');
  let fence = null;
  let start = -1;
  let level = 0;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (fence) {
      if (closesFence(lines[i], fence)) fence = null;
      continue;
    }
    fence = openFence(lines[i]);
    if (fence) continue;
    const heading = parseHeading(lines[i]);
    if (!heading) continue;
    if (start < 0) {
      if (NOTES_TITLE.test(heading.text)) {
        start = i + 1;
        level = heading.level;
      }
    } else if (heading.level <= level) {
      end = i;
      break;
    }
  }
  if (start < 0) return null;
  const section = lines.slice(start, end).map((line) => (line.trim() === '' ? '' : line));
  while (section.length && section[0] === '') section.shift();
  while (section.length && section.at(-1) === '') section.pop();
  return section.length ? section.join('\n') : null;
}

/** Notes as a quote inside the commit's list item: the list stays tight, other items render as before. */
export function formatNotes(notes) {
  return notes.split('\n').map((line) => (line === '' ? '  >' : `  > ${line}`));
}

/**
 * fetchPr's result for PR `number` → { notes } (a string, or null for none) or { warning }.
 * Notes are only used from a merged PR whose merge commit is `hash`.
 */
function readPr(number, hash, result) {
  if ('error' in result) return { warning: `PR #${number}: ${result.error}` };
  let pr;
  try {
    pr = JSON.parse(result.json);
  } catch {
    return { warning: `PR #${number}: gh printed something other than JSON` };
  }
  if (pr?.state !== 'MERGED') {
    return { warning: `PR #${number} is ${pr?.state ?? 'in an unknown state'}, not merged` };
  }
  const oid = pr.mergeCommit?.oid;
  if (oid !== hash) {
    return { warning: `PR #${number} was merged as ${oid ?? 'no commit'}, not as ${hash}` };
  }
  if (pr.body != null && typeof pr.body !== 'string') {
    return { warning: `PR #${number}: its description is not text` };
  }
  return { notes: extractReleaseNotes(pr.body ?? '') };
}

/**
 * One "- subject (abc1234)" line per commit, each ending in "\n", with its PR's release notes
 * quoted under it. fetchPr(number) returns { json } (gh's stdout) or { error }; it is only
 * called for subjects that end in "(#N)".
 */
export function buildChangelog(commits, fetchPr) {
  const lines = [];
  const warnings = [];
  for (const { hash, shortHash, subject } of commits) {
    lines.push(`- ${subject} (${shortHash})`);
    const number = prNumber(subject);
    if (number === null) continue;
    const pr = readPr(number, hash, fetchPr(number));
    if ('warning' in pr) warnings.push(`${pr.warning}; listed without release notes`);
    else if (pr.notes !== null) lines.push(...formatNotes(pr.notes));
  }
  return { markdown: lines.map((line) => `${line}\n`).join(''), warnings };
}

/** A GitHub Actions warning command; % CR LF escaped so the message stays one annotation. */
export function warningCommand(message) {
  const data = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return `::warning title=Release notes::${data}`;
}

/** Markdown for $GITHUB_STEP_SUMMARY; '' when there are no warnings. */
export function warningsSummary(warnings) {
  if (!warnings.length) return '';
  return `### Release notes warnings\n\n${warnings.map((w) => `- ${w}\n`).join('')}\n`;
}
