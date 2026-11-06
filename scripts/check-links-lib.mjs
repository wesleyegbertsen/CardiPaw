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

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
// `](<target with spaces>)` or `](target)`, with an optional "title"; one level of parentheses
// in a bare target.
const INLINE_LINK =
  /\]\(\s*(?:<([^<>\n]*)>|([^()\s<>]*(?:\([^()\s]*\)[^()\s<>]*)?))(?:\s+"[^"]*")?\s*\)/g;
const REF_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/;
const HTML_LINK = /<(?:a|img)\s[^>]*?\b(?:href|src)="([^"]*)"/gi;
const HTML_ANCHOR = /<a\s[^>]*?\b(?:id|name)="([^"]*)"/gi;

/**
 * Headings' anchors and the links on one Markdown page. Code (fenced blocks and inline code
 * spans) is skipped, so a `[x](y)` in an example is not a link.
 * @returns {{ anchors: Set<string>, links: { target: string, line: number }[] }}
 */
export function parseMarkdown(text) {
  const anchors = new Set();
  const seen = new Map();
  const links = [];
  let fence = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const f = FENCE.exec(raw);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (fence) return;
    const line = raw.replace(/(`+)(?:(?!\1).)+?\1/g, (m) => ' '.repeat(m.length));
    const h = HEADING.exec(line);
    if (h) {
      const base = slug(h[2]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n ? `${base}-${n}` : base);
    }
    for (const m of line.matchAll(HTML_ANCHOR)) anchors.add(m[1].toLowerCase());
    const add = (target) => links.push({ target, line: i + 1 });
    for (const m of line.matchAll(INLINE_LINK)) add(m[1] ?? m[2]);
    for (const m of line.matchAll(HTML_LINK)) add(m[1]);
    const ref = REF_DEFINITION.exec(line);
    if (ref) add(ref[1]);
  });
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
      const pathPart = hash < 0 ? target : target.slice(0, hash);
      const anchor = hash < 0 ? undefined : decodeURIComponent(target.slice(hash + 1));
      if (pathPart.startsWith('/')) {
        fail('starts with /: write it relative to this page');
        continue;
      }
      let dest = page;
      if (pathPart) {
        dest = posix.normalize(posix.join(posix.dirname(page), decodeURIComponent(pathPart)));
        dest = dest.replace(/\/$/, '');
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
      if (pages.has(dest)) {
        if (!info(dest).anchors.has(anchor.toLowerCase()))
          fail(`no heading in ${dest} has the anchor #${anchor}`);
      } else if (!LINE_ANCHOR.test(anchor)) {
        fail(`${dest} is not a Markdown page, so only #L<line> anchors work there`);
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
