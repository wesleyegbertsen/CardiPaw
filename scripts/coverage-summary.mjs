// Turns the coverage text table (coverage/coverage.txt, written by `npm run test:coverage`)
// into a Markdown table for the GitHub Actions job summary.
// Usage: node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY"

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABLE = join(__dirname, '..', 'coverage', 'coverage.txt');

const lines = readFileSync(TABLE, 'utf8').split('\n');

// Rows look like "  DatePicker.vue |   96.93 |   93.02 |     100 |   96.93 | 112,176,188-189".
// Separator rows hold only dashes and pipes; the first remaining row is the header.
const [header, ...rows] = lines
  .filter((line) => line.trim() && !/^[-|]+$/.test(line.trim()))
  .map((line) => line.split('|'));

const COLUMNS = 6;
for (const cells of [header, ...rows]) {
  if (cells?.length !== COLUMNS) {
    // A changed istanbul format should fail loudly, not post a garbled table.
    console.error(`Unexpected row in ${TABLE}: ${cells?.join('|')}`);
    process.exit(1);
  }
}

const out = [
  '## Test coverage',
  '',
  'Files at 100% are left out. Run `npm run test:coverage` and open `coverage/index.html` for details.',
  '',
  `| ${header.map((cell) => cell.trim()).join(' | ')} |`,
  '| :-- | --: | --: | --: | --: | :-- |',
];

for (const [name, ...cells] of rows) {
  // istanbul indents a directory by one space and its files by two; "All files" has none.
  const depth = name.length - name.trimStart().length;
  const values = cells.map((cell) => cell.trim());
  // Spaces after the commas let a long list of uncovered lines wrap.
  values[values.length - 1] = values.at(-1).replaceAll(',', ', ');
  out.push(
    depth < 2
      ? `| **${name.trim()}** | ${values.map((v) => (v ? `**${v}**` : '')).join(' | ')} |`
      : `| ${'&emsp;'.repeat(depth - 1)}${name.trim()} | ${values.join(' | ')} |`,
  );
}

console.log(out.join('\n'));
