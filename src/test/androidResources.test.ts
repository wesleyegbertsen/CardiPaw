// Checks the Android resources that aapt only sees in the CI `android` job (there is no
// Android SDK locally): references resolve, generated files aren't shadowed or stale,
// and the launch screen uses the icon and the app's background colours.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RES = join(ROOT, 'android/app/src/main/res');
// Capacitor's library resources are merged into the app (colorPrimary and others).
const CAPACITOR_RES = join(ROOT, 'node_modules/@capacitor/android/capacitor/src/main/res');
const MANIFEST = join(ROOT, 'android/app/src/main/AndroidManifest.xml');

/** Every file under a res directory, as "folder/file". */
function resFiles(res: string): string[] {
  return readdirSync(res, { withFileTypes: true })
    .filter((dir) => dir.isDirectory())
    .flatMap((dir) => readdirSync(join(res, dir.name)).map((file) => `${dir.name}/${file}`));
}

/** The resources a file defines, as "type/name" keys. */
function definitions(res: string, file: string): string[] {
  const [folder, name] = file.split('/');
  const type = folder.split('-')[0];
  if (type !== 'values') return [`${type}/${name.replace(/\..*$/, '')}`];
  const xml = readFileSync(join(res, file), 'utf8');
  return [...xml.matchAll(/<(color|string|style|dimen|integer|bool)\b[^>]*\bname="([^"]+)"/g)].map(
    ([, tag, value]) => `${tag}/${value}`,
  );
}

function xmlWithoutComments(path: string): string {
  return readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
}

describe('Android resources', () => {
  const files = resFiles(RES);

  it('resolves every @type/name reference in res/ and the manifest', () => {
    const defined = new Set(
      [
        ...files.map((f) => [RES, f]),
        ...resFiles(CAPACITOR_RES).map((f) => [CAPACITOR_RES, f]),
      ].flatMap(([res, f]) => definitions(res, f)),
    );
    const sources = [...files.filter((f) => f.endsWith('.xml')).map((f) => join(RES, f)), MANIFEST];
    const unresolved = sources.flatMap((path) =>
      [
        ...xmlWithoutComments(path).matchAll(
          /@(drawable|mipmap|color|style|string|xml|layout|bool|dimen|integer)\/([\w.]+)/g,
        ),
      ]
        .map(([, type, name]) => `${type}/${name}`)
        .filter((ref) => !defined.has(ref))
        .map((ref) => `${path.slice(ROOT.length)}: @${ref}`),
    );
    expect(unresolved).toEqual([]);
  });

  it('defines no resource twice in one folder (e.g. foo.png next to foo.xml)', () => {
    const keys = files.flatMap((file) =>
      definitions(RES, file).map((key) => `${file.split('/')[0]}: ${key}`),
    );
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([]);
  });

  it('has the launcher foreground only where the generator writes it', () => {
    // A drawable-v24/ copy would win over drawable/ on every supported device (minSdk 24).
    expect(
      files.filter((f) => /^(drawable|mipmap)[^/]*\/ic_launcher_foreground\./.test(f)),
    ).toEqual(['drawable/ic_launcher_foreground.xml']);
  });

  it('is up to date with public/favicon.svg', () => {
    // Throws, printing the stale files, when the script exits 1.
    execFileSync(process.execPath, ['scripts/generate-android-assets.mjs', '--check'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  });
});
