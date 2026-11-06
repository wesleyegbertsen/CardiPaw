// Offline checks for the relative links in the repository's Markdown files: the file a link
// points at must exist for git (tracked, or new and not ignored), and a #fragment must match a
// heading on that page under GitHub's anchor rules. External (https:, mailto:, …) links are not
// fetched.
// Node built-ins only, like the other scripts in scripts/. The CLI is check-links.mjs.

import { posix } from 'path';

/** GitHub's anchor for a heading's text (before the -1, -2 suffix of a repeated heading). */
export function slug(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // a link or image counts as its text
    .replace(/<[^>]+>/g, '') // inline HTML tags
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/d;
const CODE_SPAN = /(`+)((?:(?!\1).)+?)\1/g;
// A code span's text counts for the anchor. Its <, >, [, ] and ( ) are punctuation that the
// slug drops anyway; dropping them first keeps slug() from reading them as HTML or a link.
const codeText = (s) => s.replace(CODE_SPAN, (_, ticks, code) => code.replace(/[<>[\]()]/g, ''));
// A link's optional title: "title", 'title' or (title).
const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?`;
// `](<target with spaces>)` or `](target)`, with an optional title; one level of parentheses
// in a bare target.
const INLINE_LINK = new RegExp(
  String.raw`\]\(\s*(?:<([^<>\n]*)>|([^()\s<>]*(?:\([^()\s]*\)[^()\s<>]*)?))${TITLE}\s*\)`,
  'g',
);
const REF_DEFINITION = new RegExp(String.raw`^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?${TITLE}\s*$`);
const HTML_LINK = /<(?:a|img)\s[^>]*?\b(?:href|src)=(?:"([^"]*)"|'([^']*)')/gi;
// GitHub keeps id="…" on any tag and name="…" on <a> as an anchor.
const HTML_ID = /<[a-z][a-z0-9-]*\s[^>]*?(?<=\s)id=(?:"([^"]*)"|'([^']*)')/gi;
const HTML_NAME = /<a\s[^>]*?(?<=\s)name=(?:"([^"]*)"|'([^']*)')/gi;
// An HTML comment, or the start of one that goes on past the end of the line.
const COMMENT = /<!--[\s\S]*?(-->|$)/g;

/**
 * Headings' anchors and the links on one Markdown page. Code (fenced blocks and inline code
 * spans) and HTML comments are skipped, so a `[x](y)` in an example is not a link.
 * @returns {{ anchors: Set<string>, links: { target: string, line: number }[] }}
 */
export function parseMarkdown(text) {
  const anchors = new Set();
  // GitHub's (github-slugger's) count per heading anchor: a repeated anchor gets the first free
  // -1, -2, … suffix, so `Notes`, `Notes 1`, `Notes` give notes, notes-1, notes-2.
  const seen = new Map();
  const links = [];
  let fence = null;
  let comment = false;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let [i, raw] of lines.entries()) {
    if (comment) {
      const end = raw.indexOf('-->');
      if (end < 0) continue;
      comment = false;
      raw = ' '.repeat(end + 3) + raw.slice(end + 3);
    }
    const f = FENCE.exec(raw);
    if (fence) {
      // A closing fence has the opening's character, at least as many, and no info string.
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    // HTML comments are found with code blanked out (a `<!--` in code is no comment) and then
    // blanked out too, at the same positions, in the raw line.
    const noCode = raw.replace(CODE_SPAN, (m) => ' '.repeat(m.length));
    const ranges = [];
    for (const m of noCode.matchAll(COMMENT)) {
      ranges.push([m.index, m.index + m[0].length]);
      if (!m[1]) comment = true;
    }
    const blank = (s) =>
      ranges.reduce((t, [a, b]) => t.slice(0, a) + ' '.repeat(b - a) + t.slice(b), s);
    const visible = blank(raw);
    const line = blank(noCode);
    // The heading is found with code filled in (not spaces, which the trailing \s* would take),
    // and its text read from the visible line.
    const h = HEADING.exec(visible.replace(CODE_SPAN, (m) => 'x'.repeat(m.length)));
    if (h) {
      const base = slug(codeText(visible.slice(...h.indices[2])));
      let anchor = base;
      while (seen.has(anchor)) {
        seen.set(base, seen.get(base) + 1);
        anchor = `${base}-${seen.get(base)}`;
      }
      seen.set(anchor, 0);
      anchors.add(anchor);
    }
    for (const m of line.matchAll(HTML_ID)) anchors.add((m[1] ?? m[2]).toLowerCase());
    for (const m of line.matchAll(HTML_NAME)) anchors.add((m[1] ?? m[2]).toLowerCase());
    const add = (target) => links.push({ target, line: i + 1 });
    for (const m of line.matchAll(INLINE_LINK)) add(m[1] ?? m[2]);
    for (const m of line.matchAll(HTML_LINK)) add(m[1] ?? m[2]);
    const ref = REF_DEFINITION.exec(line);
    if (ref) add(ref[1]);
  }
  return { anchors, links };
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;
// GitHub's line anchors on a file's blob page, e.g. #L12 or #L12-L20.
const LINE_ANCHOR = /^L\d+(-L\d+)?$/;

/**
 * Every broken relative link in the given Markdown pages.
 * @param {Map<string, string>} pages repo-relative posix path -> Markdown text
 * @param {Set<string>} tracked repo-relative posix paths of every file git tracks or would add
 * @param {Record<string, string[]>} required anchors that must exist, per page
 * @returns {{ broken: string[], checked: number }}
 */
export function checkLinks(pages, tracked, required = {}) {
  const dirs = new Set(['']);
  for (const p of tracked) {
    for (let d = posix.dirname(p); d !== '.' && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
  }
  const parsed = new Map();
  const info = (p) => {
    if (!parsed.has(p)) parsed.set(p, parseMarkdown(pages.get(p)));
    return parsed.get(p);
  };
  const broken = [];
  let checked = 0;
  for (const page of [...pages.keys()].sort()) {
    for (const { target, line } of info(page).links) {
      if (EXTERNAL.test(target) || target === '') continue;
      checked++;
      const fail = (why) => broken.push(`${page}:${line}: ${target} (${why})`);
      const hash = target.indexOf('#');
      const beforeHash = hash < 0 ? target : target.slice(0, hash);
      const [pathPart, query = ''] = beforeHash.split('?');
      // GitHub shows a Markdown file's source for ?plain=1, with line anchors and no headings.
      const plain = /(?:^|&)plain=1(?:&|$)/.test(query);
      let anchor, path;
      try {
        anchor = hash < 0 ? undefined : decodeURIComponent(target.slice(hash + 1));
        path = decodeURIComponent(pathPart);
      } catch {
        fail('has a malformed %-escape: write % as %25');
        continue;
      }
      if (pathPart.startsWith('/')) {
        fail('starts with /: write it relative to this page');
        continue;
      }
      let dest = page;
      if (pathPart) {
        dest = posix.normalize(posix.join(posix.dirname(page), path));
        dest = dest.replace(/\/$/, '');
        if (dest === '.') dest = ''; // ../ from docs/, or ./ from the root: the repo root
        if (dest.startsWith('..')) {
          fail('points outside the repository');
          continue;
        }
        if (!tracked.has(dest) && !dirs.has(dest)) {
          fail('no such file, or git ignores it; check the path and its upper/lower case');
          continue;
        }
      }
      if (anchor === undefined || anchor === '') continue;
      if (pages.has(dest) && !plain) {
        if (!info(dest).anchors.has(anchor.toLowerCase()))
          fail(`no heading in ${dest} has the anchor #${anchor}`);
      } else if (!LINE_ANCHOR.test(anchor)) {
        fail(
          plain
            ? `?plain=1 shows ${dest} as source, so only #L<line> anchors work there`
            : `${dest} is not a Markdown page, so only #L<line> anchors work there`,
        );
      }
    }
  }
  for (const [page, anchors] of Object.entries(required)) {
    if (!pages.has(page)) {
      broken.push(`${page}: missing, but it must have the anchors ${anchors.join(', ')}`);
      continue;
    }
    for (const a of anchors)
      if (!info(page).anchors.has(a)) broken.push(`${page}: the heading for #${a} is gone`);
  }
  return { broken, checked };
}
