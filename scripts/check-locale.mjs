// Checks that locale files have exactly the same set of keys as the English base.
// Usage:  npm run check-locale              (checks every locale)
//         npm run check-locale -- <code>... (checks only the given locales)
// Example: npm run check-locale -- fr

import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '..', 'src', 'i18n', 'locales');

const requested = process.argv.slice(2);

if (requested.includes('en')) {
  console.error('en is the base — nothing to check it against.');
  process.exit(1);
}

const codes = requested.length
  ? requested
  : readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith('.json') && f !== 'en.json')
      .map((f) => f.slice(0, -'.json'.length))
      .sort();

if (!codes.length) {
  console.error('No locale files found besides en.json.');
  process.exit(1);
}

function flatKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`Could not parse ${label}: ${err.message}`);
    return null;
  }
}

const en = readJson(join(LOCALES_DIR, 'en.json'), 'src/i18n/locales/en.json');
if (!en) process.exit(1);
const enKeys = new Set(flatKeys(en));

/** Returns true when the locale matches en.json exactly. */
function checkLocale(code) {
  const targetPath = join(LOCALES_DIR, `${code}.json`);
  if (!existsSync(targetPath)) {
    console.error(`Locale file not found: src/i18n/locales/${code}.json`);
    return false;
  }

  const target = readJson(targetPath, `src/i18n/locales/${code}.json`);
  if (!target) return false;
  const targetKeys = new Set(flatKeys(target));

  const missing = [...enKeys].filter((k) => !targetKeys.has(k));
  const extra = [...targetKeys].filter((k) => !enKeys.has(k));

  if (missing.length) {
    console.error(`\nMissing in ${code}.json (${missing.length}):`);
    missing.forEach((k) => console.error(`  - ${k}`));
  }

  if (extra.length) {
    console.error(`\nExtra in ${code}.json (${extra.length}):`);
    extra.forEach((k) => console.error(`  + ${k}`));
  }

  if (missing.length || extra.length) return false;
  console.log(`✓ ${code}.json matches all ${enKeys.size} keys in en.json`);
  return true;
}

// Check every locale before exiting so one run reports all problems.
const results = codes.map(checkLocale);
process.exit(results.every(Boolean) ? 0 : 1);
