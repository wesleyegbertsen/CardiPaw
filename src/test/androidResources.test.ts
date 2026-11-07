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

/** A --color-<name> custom property's hex value in one global.css block. */
function cssVar(selector: string, name: string): string {
  const css = readFileSync(join(ROOT, 'src/assets/styles/global.css'), 'utf8');
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`global.css: no "${selector} {" block`);
  // Only this block, so a value from a later block can't stand in for a missing one.
  const block = css.slice(start, css.indexOf('}', start));
  const color = block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!color) throw new Error(`global.css: no --color-${name} in the ${selector} block`);
  return color[1].toLowerCase();
}

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A component's whole block in the manifest, e.g. <receiver android:name=".x">...</receiver>. */
function manifestComponent(tag: string, name: string): string {
  const block = xmlWithoutComments(MANIFEST).match(
    new RegExp(`<${tag}\\b[^>]*\\bandroid:name="${name.replace(/\./g, '\\.')}"[\\s\\S]*?</${tag}>`),
  )?.[0];
  if (!block) throw new Error(`AndroidManifest.xml: no <${tag}> ${name}`);
  return block;
}

/** The <string> names in one values folder, with whether each is translatable. */
function strings(folder: string): Map<string, boolean> {
  const xml = xmlWithoutComments(join(RES, folder, 'strings.xml'));
  return new Map(
    [...xml.matchAll(/<string\s+name="([^"]+)"([^>]*)>/g)].map(([, name, rest]) => [
      name,
      !/\btranslatable="false"/.test(rest),
    ]),
  );
}

const WIDGET_JAVA = join(ROOT, 'android/app/src/main/java/com/cardipaw/app/widget');

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

  it("registers the immersive mode plugin under its own name, not Capacitor's SystemBars", () => {
    const java = join(ROOT, 'android/app/src/main/java/com/cardipaw/app');
    const plugin = readFileSync(join(java, 'ImmersiveModePlugin.java'), 'utf8');
    const ts = readFileSync(join(ROOT, 'src/native/immersiveMode.ts'), 'utf8');
    const javaName = plugin.match(/@CapacitorPlugin\(name = "([^"]+)"\)/)?.[1];
    // "SystemBars" is Capacitor's own plugin (the theme's bar style, the safe-area insets):
    // a second plugin under that name would replace it in the bridge.
    expect(javaName).toBe('ImmersiveMode');
    expect(ts.match(/registerPlugin<\w+>\('([^']+)'\)/)?.[1]).toBe(javaName);
    const activity = readFileSync(join(java, 'MainActivity.java'), 'utf8');
    const register = activity.indexOf('registerPlugin(ImmersiveModePlugin.class);');
    expect(register).toBeGreaterThan(-1);
    expect(register).toBeLessThan(activity.indexOf('super.onCreate('));
  });

  it('registers the home widget plugin under the name the web code calls', () => {
    const java = join(ROOT, 'android/app/src/main/java/com/cardipaw/app');
    const plugin = readFileSync(join(java, 'widget/HomeWidgetPlugin.java'), 'utf8');
    const ts = readFileSync(join(ROOT, 'src/native/homeWidget.ts'), 'utf8');
    const javaName = plugin.match(/@CapacitorPlugin\(name = "([^"]+)"\)/)?.[1];
    expect(javaName).toBe('HomeWidget');
    expect(ts.match(/registerPlugin<\w+>\('([^']+)'\)/)?.[1]).toBe(javaName);
    const activity = readFileSync(join(java, 'MainActivity.java'), 'utf8');
    const register = activity.indexOf('registerPlugin(HomeWidgetPlugin.class);');
    expect(register).toBeGreaterThan(-1);
    expect(register).toBeLessThan(activity.indexOf('super.onCreate('));
  });

  it('forgets a handled widget tap before the bridge is created', () => {
    // The bridge reads the intent in super.onCreate: cleared after it, a recreated activity
    // (process death, Recents) opens the old tap's pet again.
    const activity = readFileSync(
      join(ROOT, 'android/app/src/main/java/com/cardipaw/app/MainActivity.java'),
      'utf8',
    );
    const forget = activity.indexOf('forgetHandledWidgetTap(savedInstanceState);');
    expect(forget).toBeGreaterThan(-1);
    expect(forget).toBeLessThan(activity.indexOf('super.onCreate('));
    // The scheme it checks is the one the web code parses.
    const ts = readFileSync(join(ROOT, 'src/utils/widgetUrl.ts'), 'utf8');
    const scheme = ts.match(/WIDGET_URL_SCHEME = '([^']+)'/)?.[1];
    expect(scheme).toBe('cardipaw-widget');
    expect(activity.match(/"([^"]+)"\.equals\(data\.getScheme\(\)\)/)?.[1]).toBe(scheme);
    // And the one the widgets' taps use.
    const intents = readFileSync(join(WIDGET_JAVA, 'WidgetIntents.java'), 'utf8');
    expect(intents.match(/SCHEME = "([^"]+)"/)?.[1]).toBe(scheme);
  });

  it('declares INTERNET (the update check) and CAMERA (camera counting), never REQUEST_INSTALL_PACKAGES', () => {
    // A tools:node="remove" entry takes a plugin's permission out; it declares nothing.
    const permissions = [
      ...xmlWithoutComments(MANIFEST).matchAll(/<uses-permission\s+android:name="([^"]+)"([^>]*)>/g),
    ]
      .filter(([, , rest]) => !rest.includes('tools:node="remove"'))
      .map(([, name]) => name);
    expect(permissions).toEqual(['android.permission.INTERNET', 'android.permission.CAMERA']);
  });

  it('declares the camera features the CAMERA permission implies as optional', () => {
    const features = [
      ...xmlWithoutComments(MANIFEST).matchAll(/<uses-feature\s+android:name="([^"]+)"([^>]*)\/>/g),
    ].map(([, name, rest]) => [name, /android:required="false"/.test(rest)]);
    expect(features).toEqual([
      ['android.hardware.camera', true],
      ['android.hardware.camera.autofocus', true],
    ]);
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
    expect(colorResource('values', 'app_background')).toBe(cssVar(':root', 'bg'));
    expect(colorResource('values-night', 'app_background')).toBe(
      cssVar('[data-theme="dark"]', 'bg'),
    );
  });

  it('uses the app colours for the widget surface and the warning and danger text', () => {
    const pairs = [
      ['widget_surface', 'surface'],
      ['widget_text', 'text'],
      ['widget_warning_text', 'warning-text'],
      ['widget_danger_text', 'danger-text'],
    ];
    for (const [resource, token] of pairs) {
      expect(colorResource('values', resource), resource).toBe(cssVar(':root', token));
      expect(colorResource('values-night', resource), resource).toBe(
        cssVar('[data-theme="dark"]', token),
      );
    }
  });

  it('gives every widget text colour at least 4.5:1 on its background, light and dark', () => {
    // The badges carry the status as text, so their text must be readable, not just coloured.
    const pairs = [
      ['widget_text', 'widget_surface'],
      ['widget_text_muted', 'widget_surface'],
      ['widget_stale', 'widget_surface'],
      ['widget_avatar_text', 'widget_avatar_bg'],
      ['widget_normal_text', 'widget_normal_bg'],
      ['widget_warning_text', 'widget_warning_bg'],
      ['widget_danger_text', 'widget_danger_bg'],
    ];
    const low = ['values', 'values-night'].flatMap((folder) =>
      pairs
        .map(([text, bg]) => {
          const [fg, back] = [colorResource(folder, text), colorResource(folder, bg)];
          if (!fg || !back) return `${folder}: ${text} or ${bg} missing`;
          const ratio = contrast(fg, back);
          return ratio < 4.5 ? `${folder}: ${text} on ${bg} is ${ratio.toFixed(2)}:1` : undefined;
        })
        .filter(Boolean),
    );
    expect(low).toEqual([]);
  });

  it('declares each widget provider exported for APPWIDGET_UPDATE, with its provider info', () => {
    // Not exported or without the action, the launcher never lists the widget.
    const providers = [
      ['.widget.PetWidgetProvider', 'widget_pet_info'],
      ['.widget.AllPetsWidgetProvider', 'widget_all_pets_info'],
    ];
    for (const [name, info] of providers) {
      const receiver = manifestComponent('receiver', name);
      expect(receiver, name).toMatch(/\bandroid:exported="true"/);
      // Only the system's widget service may send to it: no other app can trigger a redraw or
      // an onDeleted that forgets a widget's pet.
      expect(receiver, name).toMatch(/\bandroid:permission="android\.permission\.BIND_APPWIDGET"/);
      expect(receiver, name).toContain(
        '<action android:name="android.appwidget.action.APPWIDGET_UPDATE" />',
      );
      expect(receiver, name).toMatch(
        new RegExp(
          `android:name="android\\.appwidget\\.provider"\\s+android:resource="@xml/${info}"`,
        ),
      );
      expect(files).toContain(`xml/${info}.xml`);
    }
  });

  it('opens the pet picker from APPWIDGET_CONFIGURE, and the provider info names it', () => {
    const activity = manifestComponent('activity', '.widget.WidgetConfigureActivity');
    expect(activity).toMatch(/\bandroid:exported="true"/);
    expect(activity).toContain(
      '<action android:name="android.appwidget.action.APPWIDGET_CONFIGURE" />',
    );
    // The launcher starts android:configure by its full class name.
    const info = xmlWithoutComments(join(RES, 'xml/widget_pet_info.xml'));
    expect(info.match(/\bandroid:configure="([^"]+)"/)?.[1]).toBe(
      'com.cardipaw.app.widget.WidgetConfigureActivity',
    );
    expect(
      readFileSync(join(WIDGET_JAVA, 'WidgetConfigureActivity.java'), 'utf8'),
    ).toContain('public class WidgetConfigureActivity ');
  });

  it("configures only CardiPaw's own single-pet widgets, and draws the widget before the picker", () => {
    // The activity is exported: another app could hand it any widget id. And until a pet is
    // picked, the launcher shows the blank initial layout without the explicit draw.
    const java = readFileSync(join(WIDGET_JAVA, 'WidgetConfigureActivity.java'), 'utf8');
    const onCreate = java.match(/protected void onCreate\([\s\S]*?\n {4}\}/)?.[0] ?? '';
    const at = (s: string) => onCreate.indexOf(s);
    const content = at('setContentView(');
    expect(content).toBeGreaterThan(-1);
    for (const step of [
      'getAppWidgetInfo(widgetId)',
      'new ComponentName(this, PetWidgetProvider.class).equals(info.provider)',
      'WidgetUpdater.updatePet(this, ',
    ]) {
      expect(at(step), step).toBeGreaterThan(-1);
      expect(at(step), step).toBeLessThan(content);
    }
  });

  it('puts the widgets on the home screen only (not the lock screen)', () => {
    // The pet's name and rate are visible on a widget: never on the lock screen.
    const infos = files.filter((f) => /^xml\/widget_\w+_info\.xml$/.test(f));
    expect([...infos].sort()).toEqual(['xml/widget_all_pets_info.xml', 'xml/widget_pet_info.xml']);
    const categories = infos.map(
      (f) => [f, xmlWithoutComments(join(RES, f)).match(/\bandroid:widgetCategory="([^"]+)"/)?.[1]],
    );
    expect(categories).toEqual(infos.map((f) => [f, 'home_screen']));
  });

  it('refreshes the widgets every 12 hours as a safety net, not hourly', () => {
    // The midnight alarm and the clock/time zone broadcasts keep the age right; the period only
    // bounds how stale a widget gets if the alarm was cancelled. Each refresh wakes the app.
    const periods = ['xml/widget_pet_info.xml', 'xml/widget_all_pets_info.xml'].map((f) => [
      f,
      xmlWithoutComments(join(RES, f)).match(/\bandroid:updatePeriodMillis="(\d+)"/)?.[1],
    ]);
    expect(periods).toEqual([
      ['xml/widget_pet_info.xml', String(12 * 60 * 60 * 1000)],
      ['xml/widget_all_pets_info.xml', String(12 * 60 * 60 * 1000)],
    ]);
  });

  it('redraws on clock, time zone and language changes, never DATE_CHANGED', () => {
    // DATE_CHANGED isn't exempt from Android 8's implicit broadcast limits: it would silently
    // never arrive (the midnight alarm covers it).
    const receiver = manifestComponent('receiver', '.widget.WidgetRefreshReceiver');
    expect(receiver).toMatch(/\bandroid:exported="true"/);
    expect([...receiver.matchAll(/<action android:name="([^"]+)"/g)].map(([, a]) => a)).toEqual([
      'android.intent.action.TIME_SET',
      'android.intent.action.TIMEZONE_CHANGED',
      'android.intent.action.LOCALE_CHANGED',
    ]);
  });

  it('has every Android string in every app locale, and no extra', () => {
    // A string the launcher shows (a widget's label) in English only would fail lint's
    // MissingTranslation; one only in values-<code> is never used.
    const index = readFileSync(join(ROOT, 'src/i18n/index.ts'), 'utf8');
    const codes = [
      ...(index.match(/SUPPORTED_LOCALES = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g),
    ].map(([, code]) => code);
    expect(codes).toContain('en');
    const base = strings('values');
    const translatable = [...base].filter(([, t]) => t).map(([name]) => name);
    expect(translatable.length).toBeGreaterThan(0);
    for (const code of codes.filter((c) => c !== 'en')) {
      const local = strings(`values-${code}`);
      expect([...local.keys()].sort(), code).toEqual([...translatable].sort());
      expect([...local].filter(([, t]) => !t), code).toEqual([]);
    }
  });

  it('gives each pet layout every view the code sets', () => {
    // RemoteViews applies setViewVisibility to a missing id as an error: "Can't load widget".
    const ids = ['widget_root', 'initial', 'name', 'rate', 'badge_normal', 'badge_warning'];
    ids.push('badge_danger', 'trend', 'age', 'age_stale');
    for (const layout of ['widget_pet', 'widget_pet_small', 'widget_all_pets_row']) {
      const xml = xmlWithoutComments(join(RES, `layout/${layout}.xml`));
      const defined = [...xml.matchAll(/android:id="@\+id\/(\w+)"/g)].map(([, id]) => id);
      expect(defined.sort(), layout).toEqual([...ids].sort());
    }
  });

  it('stops the midnight alarm when the last widget is removed', () => {
    // Without this a phone with no widget left still wakes the app every midnight.
    for (const provider of ['PetWidgetProvider', 'AllPetsWidgetProvider']) {
      const java = readFileSync(join(WIDGET_JAVA, `${provider}.java`), 'utf8');
      expect(java, provider).toMatch(/public void onDisabled\(Context ctx\)[\s\S]*?cancelMidnight\(/);
    }
    const updater = readFileSync(join(WIDGET_JAVA, 'WidgetUpdater.java'), 'utf8');
    const updateAll = updater.match(/static void updateAll\([\s\S]*?\n {4}\}/)?.[0];
    expect(updateAll).toMatch(/needsMidnight\([\s\S]*cancelMidnight\(ctx\)/);
  });

  it('sets no widget colour from code', () => {
    // A colour set on RemoteViews stays until the next redraw: it wouldn't follow a dark mode
    // switch. The layouts' @color references (values-night) do.
    const used = readdirSync(WIDGET_JAVA).flatMap((file) =>
      [
        ...readFileSync(join(WIDGET_JAVA, file), 'utf8').matchAll(
          /setTextColor\(|getColor\(|"setBackgroundColor"/g,
        ),
      ].map(([match]) => `${file}: ${match}`),
    );
    expect(readdirSync(WIDGET_JAVA)).toContain('WidgetUpdater.java');
    expect(used).toEqual([]);
  });
});
