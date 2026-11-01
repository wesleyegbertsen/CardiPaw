// Checks the Android resources without an Android SDK (aapt only runs in a Gradle build: the
// CI `android` job, or locally with the android-verify skill): references resolve, generated
// files aren't shadowed or stale, and the launch screen uses the icon and the app's colours.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// jsdom (a devDependency) has no type declarations installed; its XML mode throws on
// malformed XML.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (xml: string, options: { contentType: 'text/xml' }) => unknown;
};

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

function styleItems(name: string): { parent: string | undefined; items: Record<string, string> } {
  const xml = readFileSync(join(RES, 'values/styles.xml'), 'utf8');
  const style = xml.match(
    new RegExp(`<style name="${name}"(?: parent="([^"]*)")?>([\\s\\S]*?)</style>`),
  );
  if (!style) throw new Error(`values/styles.xml has no style ${name}`);
  const items = [...style[2].matchAll(/<item name="([^"]+)"[^>]*>([^<]*)<\/item>/g)];
  return { parent: style[1], items: Object.fromEntries(items.map(([, k, v]) => [k, v.trim()])) };
}

function cssBackground(selector: string): string {
  const css = readFileSync(join(ROOT, 'src/assets/styles/global.css'), 'utf8');
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`global.css: no "${selector} {" block`);
  // Only this block, so a value from a later block can't stand in for a missing one.
  const block = css.slice(start, css.indexOf('}', start));
  const color = block.match(/--color-bg:\s*(#[0-9a-fA-F]{6})/);
  if (!color) throw new Error(`global.css: no --color-bg in the ${selector} block`);
  return color[1].toLowerCase();
}

function colorResource(folder: string, name: string): string | undefined {
  const xml = readFileSync(join(RES, folder, 'colors.xml'), 'utf8');
  return xml
    .match(new RegExp(`<color name="${name}">(#[0-9a-fA-F]{6})</color>`))?.[1]
    .toLowerCase();
}

describe('Android resources', () => {
  const files = resFiles(RES);

  it('has only well-formed XML in res/ and the manifest', () => {
    // aapt rejects malformed XML, e.g. "--" inside a comment (a CSS custom property name).
    const malformed = [
      ...files.filter((f) => f.endsWith('.xml')).map((f) => join(RES, f)),
      MANIFEST,
    ]
      .map((path) => {
        try {
          new JSDOM(readFileSync(path, 'utf8'), { contentType: 'text/xml' });
          return undefined;
        } catch (err) {
          return `${path.slice(ROOT.length)}: ${(err as Error).message.split('\n')[0]}`;
        }
      })
      .filter(Boolean);
    expect(malformed).toEqual([]);
  });

  it('generates no XML comment containing "--"', () => {
    // The generated files are parsed above as checked in; this checks the script's own
    // comment templates, so a change to them can't produce XML that aapt rejects.
    const script = readFileSync(join(ROOT, 'scripts/generate-android-assets.mjs'), 'utf8');
    const comments = [...script.matchAll(/<!--([\s\S]*?)-->/g)].map(([, body]) => body);
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.filter((body) => body.includes('--'))).toEqual([]);
  });

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

  it('has the 48dp legacy launcher icons at every density (API 24-25)', () => {
    // mipmap-anydpi-v26 resolves @mipmap/ic_launcher on API 26+ only, so the reference
    // check above passes without these.
    const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    const expected = Object.fromEntries(
      Object.entries(densities).flatMap(([density, px]) =>
        ['ic_launcher', 'ic_launcher_round'].map((name) => [
          `mipmap-${density}/${name}.png`,
          `${px}x${px}`,
        ]),
      ),
    );
    const size = (file: string) => {
      if (!files.includes(file)) return 'missing';
      // A PNG's IHDR chunk holds the width and height (big-endian) at bytes 16-23.
      const png = readFileSync(join(RES, file));
      return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
    };
    expect(Object.fromEntries(Object.keys(expected).map((file) => [file, size(file)]))).toEqual(
      expected,
    );
  });

  it('opens MainActivity with the launch screen theme', () => {
    const activity = xmlWithoutComments(MANIFEST).match(
      /<activity\b[^>]*\bandroid:name="\.MainActivity"[^>]*>/,
    )?.[0];
    expect(activity?.match(/\bandroid:theme="([^"]*)"/)?.[1]).toBe(
      '@style/AppTheme.NoActionBarLaunch',
    );
  });

  it('leaves out the exact alarm permission that the notifications plugin declares', () => {
    // Reminders are inexact, so the merged manifest must not ask for SCHEDULE_EXACT_ALARM.
    const manifest = xmlWithoutComments(MANIFEST);
    expect(manifest).toMatch(
      /<manifest\b[^>]*\bxmlns:tools="http:\/\/schemas\.android\.com\/tools"/,
    );
    expect(manifest).toContain(
      '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />',
    );
  });

  it('has the notification icon that capacitor.config.ts names', () => {
    // The plugin looks smallIcon up as a drawable at runtime: a typo shows no icon at all.
    const config = readFileSync(join(ROOT, 'capacitor.config.ts'), 'utf8');
    const smallIcon = config.match(/\bsmallIcon:\s*'([^']+)'/)?.[1];
    expect(smallIcon).toBe('ic_stat_cardipaw');
    expect(files.filter((f) => f.startsWith('drawable/'))).toContain(`drawable/${smallIcon}.xml`);
  });

  it('has the notification icon only where the generator writes it', () => {
    expect(files.filter((f) => /^(drawable|mipmap)[^/]*\/ic_stat_cardipaw\./.test(f))).toEqual([
      'drawable/ic_stat_cardipaw.xml',
    ]);
  });

  it('registers the notification settings plugin under the name the web code calls', () => {
    const java = join(ROOT, 'android/app/src/main/java/com/cardipaw/app');
    const plugin = readFileSync(join(java, 'NotificationSettingsPlugin.java'), 'utf8');
    const ts = readFileSync(join(ROOT, 'src/native/notificationSettings.ts'), 'utf8');
    const javaName = plugin.match(/@CapacitorPlugin\(name = "([^"]+)"\)/)?.[1];
    expect(javaName).toBe('NotificationSettings');
    expect(ts.match(/registerPlugin<\w+>\('([^']+)'\)/)?.[1]).toBe(javaName);
    // A plugin registered after super.onCreate isn't in the bridge: every call rejects.
    const activity = readFileSync(join(java, 'MainActivity.java'), 'utf8');
    const register = activity.indexOf('registerPlugin(NotificationSettingsPlugin.class);');
    expect(register).toBeGreaterThan(-1);
    expect(register).toBeLessThan(activity.indexOf('super.onCreate('));
  });

  it('declares INTERNET (the opt-in update check) and never REQUEST_INSTALL_PACKAGES', () => {
    // A tools:node="remove" entry takes a plugin's permission out; it declares nothing.
    const permissions = [
      ...xmlWithoutComments(MANIFEST).matchAll(/<uses-permission\s+android:name="([^"]+)"([^>]*)>/g),
    ]
      .filter(([, , rest]) => !rest.includes('tools:node="remove"'))
      .map(([, name]) => name);
    expect(permissions).toEqual(['android.permission.INTERNET']);
  });

  it("keeps WebView's Safe Browsing and diagnostics from contacting Google", () => {
    const meta = Object.fromEntries(
      [...xmlWithoutComments(MANIFEST).matchAll(/<meta-data\s+android:name="([^"]+)"\s+android:value="([^"]+)"/g)]
        .map(([, name, value]) => [name, value]),
    );
    expect(meta).toMatchObject({
      'android.webkit.WebView.EnableSafeBrowsing': 'false',
      'android.webkit.WebView.MetricsOptOut': 'true',
    });
  });

  it('is up to date with public/favicon.svg', () => {
    // Throws, printing the stale files, when the script exits 1.
    execFileSync(process.execPath, ['scripts/generate-android-assets.mjs', '--check'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  });

  it('shows the paw on the app background at launch, then keeps that background', () => {
    // Theme.SplashScreen alone shows the generic Android icon (sym_def_app_icon).
    expect(styleItems('AppTheme.NoActionBarLaunch')).toEqual({
      parent: 'Theme.SplashScreen.IconBackground',
      items: {
        windowSplashScreenBackground: '@color/app_background',
        windowSplashScreenAnimatedIcon: '@drawable/ic_launcher_foreground',
        windowSplashScreenIconBackgroundColor: '@color/ic_launcher_background',
        'android:windowLightStatusBar': '@bool/light_system_bars',
        'android:windowLightNavigationBar': '@bool/light_system_bars',
      },
    });
    expect(styleItems('AppTheme.NoActionBar').items).toMatchObject({
      'android:windowBackground': '@color/app_background',
    });
  });

  it('has dark system bar icons on the launch screen in light mode only', () => {
    const lightBars = (folder: string) =>
      readFileSync(join(RES, folder, 'bools.xml'), 'utf8').match(
        /<bool name="light_system_bars">(true|false)<\/bool>/,
      )?.[1];
    expect([lightBars('values'), lightBars('values-night')]).toEqual(['true', 'false']);
  });

  it('uses the web app background colours, light and dark', () => {
    expect(colorResource('values', 'app_background')).toBe(cssBackground(':root'));
    expect(colorResource('values-night', 'app_background')).toBe(
      cssBackground('[data-theme="dark"]'),
    );
  });
});
