import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  buildChangelog,
  extractReleaseNotes,
  formatNotes,
  parseGitLog,
  prNumber,
  unsafeMarkup,
  warningCommand,
  warningsSummary,
} from './release-notes-lib.mjs';

const HASH_A = 'ad6b58e8db9ed35428d94edf930b9a6661b60993';
const HASH_B = 'af2c1254f0e2b4a1c9d8e7f6a5b4c3d2e1f0a9b8';
const HASH_C = '68ac4f3aa1b2c3d4e5f60718293a4b5c6d7e8f90';
const MERGED_AT = '2026-11-02T01:44:20Z';
// gh api graphql's stdout for PR_QUERY.
const graphql = (pullRequest) => ({
  json: JSON.stringify({ data: { repository: { pullRequest } } }),
});
const merged = (hash, body, lastEditedAt = null) =>
  graphql({ body, state: 'MERGED', mergedAt: MERGED_AT, lastEditedAt, mergeCommit: { oid: hash } });

describe('parseGitLog', () => {
  it('splits git log --format=%H%x00%h%x00%s records and keeps subjects verbatim', () => {
    const output = `${HASH_A}\0ad6b58e\0feat: x (#119)\n${HASH_B}\0af2c125\0chore: 100% \`done\` — ok\n`;
    expect(parseGitLog(output)).toEqual([
      { hash: HASH_A, shortHash: 'ad6b58e', subject: 'feat: x (#119)' },
      { hash: HASH_B, shortHash: 'af2c125', subject: 'chore: 100% `done` — ok' },
    ]);
    expect(parseGitLog('')).toEqual([]);
  });

  it('throws on a record it does not recognise', () => {
    expect(() => parseGitLog(`${HASH_A}\0ad6b58e\n`)).toThrow('Unexpected git log record');
    expect(() => parseGitLog('- feat: x (ad6b58e)\n')).toThrow('Unexpected git log record');
  });
});

describe('prNumber', () => {
  it.each([
    ['feat: x (#119)', 119],
    ['Revert "feat: a (#15)" (#16)', 16],
    ['feat: x (#15) and more', null],
    ['npm audit fix', null],
    ['fix: `(#3)`', null],
    ['Merge pull request #1 from a/b', null],
  ])('%s → %s', (subject, number) => {
    expect(prNumber(subject)).toBe(number);
  });
});

describe('extractReleaseNotes', () => {
  const body = '## Summary\nS\n\n## Release notes\n\nChannel reset.\n\n## Changes\nC';

  it('returns the section under "## Release notes", with LF line ends', () => {
    expect(extractReleaseNotes(body)).toBe('Channel reset.');
    expect(extractReleaseNotes(body.replaceAll('\n', '\r\n'))).toBe('Channel reset.');
    expect(extractReleaseNotes('## Release notes\r\nA\r\n\r\nB\r\n')).toBe('A\n\nB');
  });

  it('keeps deeper headings and ends at one of the same or a higher level', () => {
    expect(extractReleaseNotes('## Release notes\nA\n### Detail\nB\n## Changes\nC')).toBe(
      'A\n### Detail\nB',
    );
    expect(extractReleaseNotes('### Release notes\nA\n#### Detail\n## Next\nB')).toBe(
      'A\n#### Detail',
    );
    expect(extractReleaseNotes('## Summary\nS\n## Release notes\nLast')).toBe('Last');
  });

  it.each([
    '# release notes',
    '## Release Notes:',
    '## Release notes ##',
    '   ## Release notes',
    '##\tRelease notes',
  ])('finds the heading "%s"', (heading) => {
    expect(extractReleaseNotes(`${heading}\nN\n# End`)).toBe('N');
  });

  it.each([
    '#Release notes',
    '    ## Release notes',
    '## Release notes for v2',
    '####### Release notes',
    '**Release notes**',
  ])('ignores "%s"', (heading) => {
    expect(extractReleaseNotes(`${heading}\nN`)).toBeNull();
  });

  it('returns null when there is no section, or nothing but blanks and comments in it', () => {
    expect(extractReleaseNotes('')).toBeNull();
    expect(extractReleaseNotes('## Summary\nS')).toBeNull();
    expect(extractReleaseNotes('## Release notes\n\n \t\n## Changes\nC')).toBeNull();
    expect(extractReleaseNotes('## Release notes\n<!-- nothing -->\n\n## Changes\nC')).toBeNull();
  });

  it('returns null for the PR template as it is', () => {
    const template = readFileSync(
      new URL('../.github/pull_request_template.md', import.meta.url),
      'utf8',
    );
    expect(template).toMatch(/^## Release notes$/m);
    expect(extractReleaseNotes(template)).toBeNull();
    // Squash merges copy the PR description, comments included, into the commit body, where
    // GitVersion reads a line starting "BREAKING CHANGE:" as a major bump.
    expect(template).not.toMatch(/^BREAKING[ -]CHANGE:/m);
  });

  it('trims blank lines around the section and blanks whitespace-only lines', () => {
    expect(extractReleaseNotes('## Release notes\n\n \nA\n\t\n\nB  \n\n')).toBe('A\n\n\nB  ');
  });

  it('removes HTML comments, including headings inside them', () => {
    expect(
      extractReleaseNotes('## Release notes\nA <!-- hidden --> B\n<!-- multi\nline -->\nC'),
    ).toBe('A  B\n\nC');
    expect(
      extractReleaseNotes(
        '<!--\n## Release notes\nX\n-->\n## Release notes\nA\n<!-- ## End -->\nB',
      ),
    ).toBe('A\n\nB');
  });

  it('hides everything after an unclosed comment', () => {
    expect(extractReleaseNotes('## Release notes\nA\n<!-- oops\n## Changes\nX')).toBe('A');
  });

  it('ignores headings inside code fences', () => {
    expect(
      extractReleaseNotes('## Summary\n```bash\n# Release notes\n```\n## Release notes\nReal'),
    ).toBe('Real');
    expect(
      extractReleaseNotes('## Release notes\nA\n```sh\n## not a heading\n```\nB\n## End'),
    ).toBe('A\n```sh\n## not a heading\n```\nB');
  });

  it('closes a fence only with the same character, at least as long', () => {
    expect(
      extractReleaseNotes('## Release notes\n~~~~\n```\n## a\n~~~\n## b\n~~~~\nC\n## End'),
    ).toBe('~~~~\n```\n## a\n~~~\n## b\n~~~~\nC');
  });

  it('does not treat a backtick line with a backtick in its info string as a fence', () => {
    expect(extractReleaseNotes('## Release notes\n```js`\n## End\nX')).toBe('```js`');
  });

  it('runs an unclosed fence to the end of the body', () => {
    expect(extractReleaseNotes('## Release notes\n```\n## inside\n')).toBe('```\n## inside');
  });

  it('uses the first "Release notes" section', () => {
    expect(extractReleaseNotes('## Release notes\nA\n## Release notes\nB')).toBe('A');
  });
});

describe('unsafeMarkup', () => {
  it.each([
    // Rendered by GitHub: the <h1> ends up outside the release's list.
    ['</blockquote></li></ul>\n<h1>ESCAPED</h1>', 'raw HTML'],
    ['a <br/> b', 'raw HTML'],
    ['<img src=x>', 'raw HTML'],
    ['<details', 'raw HTML'],
    ['x</b>', 'raw HTML'],
    // A fence indented in a list item ends with the item, so the tag after it is not code.
    ['- a\n  ```\nb\n</blockquote><h1>X</h1>', 'raw HTML'],
    // An autolink binds tighter than a code span: the backtick in it doesn't open one.
    ['see <http://x/`> <b>B</b>`', 'raw HTML'],
    // An escaped backtick doesn't open a code span.
    ['\\`<b>x</b>`', 'raw HTML'],
    // Code spans are only recognised within a line.
    ['`a\n<b>`', 'raw HTML'],
    ['See [^1].', 'a footnote'],
    ['[^note]: text', 'a footnote'],
    ['[x]: https://example.com', 'a link reference definition'],
    ['   [x]: y', 'a link reference definition'],
    // Rendered by GitHub: a definition nested in a list item still links [zz] anywhere.
    ['- a\n\n    [zz]: https://example.com', 'a link reference definition'],
    ['> [x]: y', 'a link reference definition'],
    ['[a\nb]: y', 'a link reference definition'],
  ])('%j contains %s', (notes, kind) => {
    expect(unsafeMarkup(notes)).toBe(kind);
  });

  it.each([
    'Use `<br>` and ``a ` <b> ``.',
    'If `a < b` or `Array<string>`',
    '```html\n<div>[^1]\n[x]: y\n```',
    '~~~\n<b>\n~~~',
    '````\n```\n<b>\n```\n````',
    '```\n<b> to the end',
    '<https://example.com> and <mailto:a@b.c> and <a@b.c>',
    'x<y, 1 < 2, a <- b, <3',
    '\\<b> is shown as text, as is \\[^1] and \\[x]: y',
    'A [link](https://example.com), [x] and a [ ] task',
    '- [x] done',
  ])('%j is safe', (notes) => {
    expect(unsafeMarkup(notes)).toBeNull();
  });
});

describe('formatNotes', () => {
  it('quotes each line, with no trailing space on blank ones', () => {
    expect(formatNotes('A\n\n  B')).toEqual(['  > A', '  >', '  >   B']);
  });
});

describe('buildChangelog', () => {
  it('lists commits exactly as git log --pretty=format:"- %s (%h)" when no PR has notes', () => {
    const commits = [
      { hash: HASH_A, shortHash: 'ad6b58e', subject: 'feat(android): show when (#119)' },
      { hash: HASH_B, shortHash: 'af2c125', subject: 'chore: 100% `done` — ok' },
      { hash: HASH_C, shortHash: '68ac4f3', subject: 'Revert "feat: a (#15)" (#16)' },
    ];
    const bodies = { 119: '## Summary\nS', 16: null };
    const calls = [];
    const fetchPr = (number) => {
      calls.push(number);
      return merged(number === 119 ? HASH_A : HASH_C, bodies[number]);
    };
    expect(buildChangelog(commits, fetchPr)).toEqual({
      markdown:
        '- feat(android): show when (#119) (ad6b58e)\n' +
        '- chore: 100% `done` — ok (af2c125)\n' +
        '- Revert "feat: a (#15)" (#16) (68ac4f3)\n',
      warnings: [],
    });
    expect(calls).toEqual([119, 16]);
  });

  it('quotes a PR’s release notes under its line', () => {
    const commits = [
      { hash: HASH_A, shortHash: 'ad6b58e', subject: 'feat: x (#7)' },
      { hash: HASH_B, shortHash: 'af2c125', subject: 'fix: y' },
    ];
    const body = '## Summary\nS\n\n## Release notes\nLine 1\n\nLine 2\n## Changes\nC';
    expect(buildChangelog(commits, () => merged(HASH_A, body))).toEqual({
      markdown: '- feat: x (#7) (ad6b58e)\n  > Line 1\n  >\n  > Line 2\n- fix: y (af2c125)\n',
      warnings: [],
    });
  });

  it.each([
    ['<h1>X</h1>', 'raw HTML'],
    ['A[^1]', 'a footnote'],
    ['[x]: https://example.com', 'a link reference definition'],
  ])('leaves out notes with %j and warns that they contain %s', (notes, kind) => {
    const commits = [{ hash: HASH_A, shortHash: 'ad6b58e', subject: 'feat: x (#7)' }];
    const body = `## Release notes\n${notes}\n## Changes\nC`;
    expect(buildChangelog(commits, () => merged(HASH_A, body))).toEqual({
      markdown: '- feat: x (#7) (ad6b58e)\n',
      warnings: [
        `PR #7: its release notes contain ${kind}, which can break out of the quote; listed without release notes`,
      ],
    });
  });

  describe('with gh api graphql’s real output', () => {
    // PR #119 as gh printed it, body shortened.
    const GH_119 = String.raw`{"data":{"repository":{"pullRequest":{"body":"Closes #106.\n\n## Summary\n\nWith **Check automatically** on, Settings › Updates now has a third card:","state":"MERGED","mergedAt":"2026-11-02T01:44:20Z","lastEditedAt":null,"mergeCommit":{"oid":"ad6b58e8db9ed35428d94edf930b9a6661b60993"}}}}}`;
    const commits = [{ hash: HASH_A, shortHash: 'ad6b58e', subject: 'feat(android): x (#119)' }];

    it('lists a PR without notes as before', () => {
      expect(buildChangelog(commits, () => ({ json: GH_119 }))).toEqual({
        markdown: '- feat(android): x (#119) (ad6b58e)\n',
        warnings: [],
      });
    });

    it('quotes the notes of a PR whose description was never edited, or edited before merging', () => {
      const withSection = GH_119.replace(
        'third card:',
        String.raw`third card:\n## Release notes\nNew card.`,
      );
      const editedBefore = withSection.replace(
        '"lastEditedAt":null',
        '"lastEditedAt":"2026-11-02T01:44:19Z"',
      );
      for (const json of [withSection, editedBefore]) {
        expect(buildChangelog(commits, () => ({ json }))).toEqual({
          markdown: '- feat(android): x (#119) (ad6b58e)\n  > New card.\n',
          warnings: [],
        });
      }
    });

    it('leaves out the notes of a PR whose description was edited after merging', () => {
      const json = GH_119.replace(
        'third card:',
        String.raw`third card:\n## Release notes\nNew card.`,
      ).replace('"lastEditedAt":null', '"lastEditedAt":"2026-11-03T09:00:00Z"');
      expect(buildChangelog(commits, () => ({ json }))).toEqual({
        markdown: '- feat(android): x (#119) (ad6b58e)\n',
        warnings: [
          'PR #119: its description was edited after it was merged (2026-11-03T09:00:00Z), so its release notes may not have been reviewed; listed without release notes',
        ],
      });
    });
  });

  const withNotes = '## Release notes\nShould not appear';
  it.each([
    ['gh failed', { error: 'gh pr view failed (exit 1): GraphQL: Could not resolve' }],
    ['not JSON', { json: 'not json' }],
    ['JSON null', { json: 'null' }],
    ['no data', { json: '{}' }],
    ['no repository', { json: JSON.stringify({ data: { repository: null } }) }],
    ['no pull request', graphql(null)],
    [
      'open',
      graphql({
        body: withNotes,
        state: 'OPEN',
        mergedAt: null,
        lastEditedAt: null,
        mergeCommit: null,
      }),
    ],
    [
      'closed',
      graphql({
        body: withNotes,
        state: 'CLOSED',
        mergedAt: null,
        lastEditedAt: null,
        mergeCommit: null,
      }),
    ],
    [
      'merged, no commit',
      graphql({
        body: withNotes,
        state: 'MERGED',
        mergedAt: MERGED_AT,
        lastEditedAt: null,
        mergeCommit: null,
      }),
    ],
    ['merged as another commit', merged(HASH_B, withNotes)],
    ['edited after merging', merged(HASH_A, withNotes, '2026-11-02T01:44:21Z')],
    ['edited in the second it was merged', merged(HASH_A, withNotes, MERGED_AT)],
    [
      'edited, merge time unknown',
      graphql({
        body: withNotes,
        state: 'MERGED',
        mergedAt: null,
        lastEditedAt: MERGED_AT,
        mergeCommit: { oid: HASH_A },
      }),
    ],
    ['body not text', merged(HASH_A, 5)],
  ])('keeps the line and warns once: %s', (_, result) => {
    const commits = [{ hash: HASH_A, shortHash: 'ad6b58e', subject: 'feat: x (#7)' }];
    const { markdown, warnings } = buildChangelog(commits, () => result);
    expect(markdown).toBe('- feat: x (#7) (ad6b58e)\n');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^PR #7\b.*; listed without release notes$/);
  });
});

describe('warningCommand', () => {
  it('escapes % CR and LF', () => {
    expect(warningCommand('50% done\r\nnext')).toBe(
      '::warning title=Release notes::50%25 done%0D%0Anext',
    );
  });
});

describe('warningsSummary', () => {
  it('lists the warnings under a heading, or is empty without any', () => {
    expect(warningsSummary([])).toBe('');
    expect(warningsSummary(['a', 'b'])).toBe('### Release notes warnings\n\n- a\n- b\n\n');
  });
});
