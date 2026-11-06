// Checks the relative links and #anchors in every Markdown file git knows or would add (tracked,
// or new and not ignored), offline (see
// check-links-lib.mjs for the rules). CI runs it on every PR.
// Usage: npm run check-links
// Exits 1 and lists each broken link as <file>:<line>: <target> (<what is wrong>).

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { checkLinks } from './check-links-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Anchors that links from outside the repository depend on, so renaming the heading would break
// them without any link here noticing. Every release's notes link README.md#android
// (.github/workflows/release.yml), and published releases keep that link.
const REQUIRED = { 'README.md': ['android'] };

const tracked = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    cwd: ROOT,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);
const pages = new Map(
  tracked
    .filter((p) => p.toLowerCase().endsWith('.md'))
    .map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]),
);

const { broken, checked } = checkLinks(pages, new Set(tracked), REQUIRED);
console.log(`${pages.size} Markdown files, ${checked} relative links checked.`);
if (broken.length) {
  console.error(`${broken.length} broken:`);
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}
