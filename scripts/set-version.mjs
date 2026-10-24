// Stamps a release version into every place the app reads its version from.
// Run by the release pipeline (and the Docker build) with the SemVer determined by GitVersion.
// Usage:  npm run set-version -- <version>
// Example: npm run set-version -- 1.4.0

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Official SemVer 2.0.0 regex, with an optional leading "v" (e.g. a git tag name).
const SEMVER = /^v?((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)$/;

const input = process.argv[2];
const match = input?.match(SEMVER);

if (!match) {
  console.error('Usage: npm run set-version -- <version>');
  console.error('Example: npm run set-version -- 1.4.0');
  if (input) console.error(`\n"${input}" is not a valid SemVer version.`);
  process.exit(1);
}

const version = match[1];

function updateJson(relPath, update) {
  const path = join(ROOT, relPath);
  if (!existsSync(path)) return;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  update(json);
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`  ${relPath}`);
}

console.log(`Setting version to ${version}:`);

// package.json is the single source the app reads at build time (see vite.config.ts → __APP_VERSION__).
updateJson('package.json', (pkg) => {
  pkg.version = version;
});

// Keep the lockfile's root entry in sync so `npm ci` doesn't see a mismatch.
updateJson('package-lock.json', (lock) => {
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
});
