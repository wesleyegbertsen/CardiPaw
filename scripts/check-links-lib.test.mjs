import { describe, expect, it } from 'vitest';
import { checkLinks, parseMarkdown, slug } from './check-links-lib.mjs';

// pages: path -> Markdown. Every page is tracked, plus the extra files given.
const check = (pages, extra = [], required) => {
  const map = new Map(Object.entries(pages));
  return checkLinks(map, new Set([...map.keys(), ...extra]), required).broken;
};

describe('slug', () => {
  it.each([
    ['Data Export & Import', 'data-export--import'],
    ['Camera counting (experimental)', 'camera-counting-experimental'],
    ['Releases & Versioning', 'releases--versioning'],
    ['What Is a Resting Respiratory Rate?', 'what-is-a-resting-respiratory-rate'],
    ['2. Register the locale in `src/i18n/index.ts`', '2-register-the-locale-in-srci18nindexts'],
    ['docker-compose', 'docker-compose'],
    ['See [the docs](docs/x.md) here', 'see-the-docs-here'],
    ['Über_uns', 'über_uns'],
  ])('%s -> %s', (heading, want) => {
    expect(slug(heading)).toBe(want);
  });
});

describe('parseMarkdown', () => {
  it('numbers repeated headings like GitHub', () => {
    const { anchors } = parseMarkdown('# A\n## Notes\n## Notes\n## Notes ##\n');
    expect([...anchors]).toEqual(['a', 'notes', 'notes-1', 'notes-2']);
  });

  it('skips a heading whose numbered anchor is taken, like GitHub', () => {
    const { anchors } = parseMarkdown('## Notes\n## Notes 1\n## Notes\n');
    expect([...anchors]).toEqual(['notes', 'notes-1', 'notes-2']);
  });

  it('does not end a fence at a marker with an info string', () => {
    const md = '```\n```js\n[x](nope.md)\n```\n[y](a.md)\n';
    expect(parseMarkdown(md).links).toEqual([{ target: 'a.md', line: 5 }]);
  });

  it('skips links and headings in HTML comments', () => {
    const md = [
      '<!-- [x](nope.md) -->',
      '<!--',
      '[y](nope.md)',
      '## Hidden',
      '-->',
      '[z](a.md) <!-- [w](nope.md) --> [v](b.md) <!-- [u](nope.md)',
      '-->',
    ].join('\n');
    expect(parseMarkdown(md)).toEqual({
      anchors: new Set(),
      links: [
        { target: 'a.md', line: 6 },
        { target: 'b.md', line: 6 },
      ],
    });
  });

  it('counts id="…" on any HTML tag as an anchor', () => {
    const md = '<h2 id="Intro">Intro</h2>\n<div id=\'more\'></div>\n<p data-id="no"></p>';
    expect(parseMarkdown(md).anchors).toEqual(new Set(['intro', 'more']));
  });

  it('keeps the text of code spans in a heading, like GitHub', () => {
    const md = '### 2. Register in `src/i18n/index.ts`\n## Use `<details>` and `[a](b)`\n';
    expect([...parseMarkdown(md).anchors]).toEqual([
      '2-register-in-srci18nindexts',
      'use-details-and-ab',
    ]);
  });

  it('skips links and headings in code', () => {
    const md =
      '```md\n# Not a heading\n[x](nope.md)\n```\n~~~\n[y](nope.md)\n~~~\nUse `[z](nope.md)`.\n';
    expect(parseMarkdown(md)).toEqual({ anchors: new Set(), links: [] });
  });

  it('does not end a fence at a shorter or different marker', () => {
    const md = '````\n```\n[x](nope.md)\n~~~\n````\n[y](a.md)\n';
    expect(parseMarkdown(md).links).toEqual([{ target: 'a.md', line: 6 }]);
  });

  it('finds inline, image, nested badge, reference and HTML links', () => {
    const md = [
      '[a](a.md) and ![b](img/b.png "B")',
      '[![badge](img/c.svg)](c.md#top)',
      '[d]: d.md',
      '<img src="img/e.png" width="200"> <a href="f.md">f</a>',
      '[g](<g h.md>)',
    ].join('\n');
    expect(parseMarkdown(md).links.map((l) => l.target)).toEqual([
      'a.md',
      'img/b.png',
      'img/c.svg',
      'c.md#top',
      'd.md',
      'img/e.png',
      'f.md',
      'g h.md',
    ]);
  });

  it("finds links with 'single-quoted' and (parenthesised) titles and href='…'", () => {
    const md = [
      "[a](a.md 'A') [b](b.md (B))",
      "[c]: c.md 'C'",
      '[d]: d.md (D)',
      "<a href='e.md'>e</a> <img src='f.png'>",
    ].join('\n');
    expect(parseMarkdown(md).links.map((l) => l.target)).toEqual([
      'a.md',
      'b.md',
      'c.md',
      'd.md',
      'e.md',
      'f.png',
    ]);
  });

  it('counts <a id> and <a name> as anchors', () => {
    expect(parseMarkdown('<a id="Old-Name"></a>\n<a name="x"></a>').anchors).toEqual(
      new Set(['old-name', 'x']),
    );
  });
});

describe('checkLinks', () => {
  it('passes links to tracked files, folders, headings and code lines', () => {
    const broken = check(
      {
        'README.md': '# CardiPaw\n## Android\n[d](docs/a.md#data-export--import) [s](#android)',
        'docs/a.md':
          '# A\n## Data Export & Import\n[r](../README.md#Android) [c](../src/x.ts#L3-L9) [f](../src/)',
      },
      ['src/x.ts'],
    );
    expect(broken).toEqual([]);
  });

  it('passes ../ and ./ as the repo root and the page folder', () => {
    expect(check({ 'docs/a.md': '[x](../) [y](./)', 'README.md': '[z](./)' })).toEqual([]);
  });

  it('ignores a ?query, and allows #L anchors on a ?plain=1 page', () => {
    const broken = check({
      'a.md': '[x](b.md?plain=1#L3)\n[y](b.md?x=1#b)\n[z](b.md?plain=1#b)',
      'b.md': '# B',
    });
    expect(broken).toEqual([
      'a.md:3: b.md?plain=1#b (?plain=1 shows b.md as source, so only #L<line> anchors work there)',
    ]);
  });

  it('reads a page that starts with a byte order mark', () => {
    expect(check({ 'a.md': '\uFEFF# Title\n[x](#title)' })).toEqual([]);
  });

  it('ignores external links', () => {
    expect(
      check({ 'a.md': '[x](https://example.com/nope.md#gone) [m](mailto:x@example.com)' }),
    ).toEqual([]);
  });

  it('reports a missing file, a wrong case and an untracked file', () => {
    const broken = check({
      'docs/a.md': '[x](nope.md)\n[y](../readme.md)\n[z](../public/seed-data.json)',
      'README.md': '',
    });
    expect(broken).toEqual([
      'docs/a.md:1: nope.md (no such file, or git ignores it; check the path and its upper/lower case)',
      'docs/a.md:2: ../readme.md (no such file, or git ignores it; check the path and its upper/lower case)',
      'docs/a.md:3: ../public/seed-data.json (no such file, or git ignores it; check the path and its upper/lower case)',
    ]);
  });

  it('reports a missing anchor on the same and on another page', () => {
    const broken = check({ 'a.md': '# A\n[x](#b)\n[y](c.md#gone)', 'c.md': '# C' });
    expect(broken).toEqual([
      'a.md:2: #b (no heading in a.md has the anchor #b)',
      'a.md:3: c.md#gone (no heading in c.md has the anchor #gone)',
    ]);
  });

  it('reports root-absolute links, links out of the repo and anchors into code', () => {
    const broken = check({ 'a.md': '[x](/README.md)\n[y](../other/a.md)\n[z](x.ts#main)' }, [
      'x.ts',
    ]);
    expect(broken).toEqual([
      'a.md:1: /README.md (starts with /: write it relative to this page)',
      'a.md:2: ../other/a.md (points outside the repository)',
      'a.md:3: x.ts#main (x.ts is not a Markdown page, so only #L<line> anchors work there)',
    ]);
  });

  it('reports a malformed %-escape instead of throwing', () => {
    expect(check({ 'a.md': '# A\n[x](#50%)\n[y](b%zz.md)' })).toEqual([
      'a.md:2: #50% (has a malformed %-escape: write % as %25)',
      'a.md:3: b%zz.md (has a malformed %-escape: write % as %25)',
    ]);
  });

  it('reports a required anchor whose heading is gone', () => {
    const required = { 'README.md': ['android'] };
    expect(check({ 'README.md': '## Android' }, [], required)).toEqual([]);
    expect(check({ 'README.md': '## Android app' }, [], required)).toEqual([
      'README.md: the heading for #android is gone',
    ]);
  });
});
