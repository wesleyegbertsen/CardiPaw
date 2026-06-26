// Checks that a locale file has exactly the same set of keys as the English base.
// Usage:  npm run check-locale -- <code>
// Example: npm run check-locale -- fr

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '..', 'src', 'i18n', 'locales');

const code = process.argv[2];

if (!code) {
  console.error('Usage: npm run check-locale -- <language-code>');
  console.error('Example: npm run check-locale -- fr');
  process.exit(1);
}

if (code === 'en') {
  console.error('en is the base — nothing to check it against.');
  process.exit(1);
}

const enPath = join(LOCALES_DIR, 'en.json');
const targetPath = join(LOCALES_DIR, `${code}.json`);

if (!existsSync(targetPath)) {
  console.error(`Locale file not found: src/i18n/locales/${code}.json`);
  process.exit(1);
}

function flatKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flatKeys(v, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );
}

const en = JSON.parse(readFileSync(enPath, 'utf8'));
const target = JSON.parse(readFileSync(targetPath, 'utf8'));

const enKeys = new Set(flatKeys(en));
const targetKeys = new Set(flatKeys(target));

const missing = [...enKeys].filter(k => !targetKeys.has(k));
const extra   = [...targetKeys].filter(k => !enKeys.has(k));

if (missing.length) {
  console.error(`\nMissing in ${code}.json (${missing.length}):`);
  missing.forEach(k => console.error(`  - ${k}`));
}

if (extra.length) {
  console.error(`\nExtra in ${code}.json (${extra.length}):`);
  extra.forEach(k => console.error(`  + ${k}`));
}

if (!missing.length && !extra.length) {
  console.log(`✓ ${code}.json matches all ${enKeys.size} keys in en.json`);
  process.exit(0);
} else {
  process.exit(1);
}
