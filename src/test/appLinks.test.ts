// The Android App Link for share links (#86): the manifest's intent filter and the
// assetlinks.json that verifies it must agree with each other and with the app id.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

// The release key's certificate (repository variable ANDROID_CERT_SHA256).
const RELEASE_FINGERPRINT =
  'D8:39:9F:F4:40:85:6C:B1:FE:74:AD:5A:2C:4B:69:A7:E2:D4:5C:25:8F:12:03:E2:E7:E5:72:21:D5:59:7E:E6';

describe('share link App Link', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const filters = [...manifest.matchAll(/<intent-filter\b([^>]*)>([\s\S]*?)<\/intent-filter>/g)];
  const viewFilters = filters.filter(([, , body]) => body.includes('android.intent.action.VIEW'));

  it('declares exactly one VIEW filter, verified, for https://cardipaw.com/share/ only', () => {
    expect(viewFilters).toHaveLength(1);
    const [, attrs, body] = viewFilters[0];
    expect(attrs).toContain('android:autoVerify="true"');
    expect(body).toContain('android.intent.category.DEFAULT');
    expect(body).toContain('android.intent.category.BROWSABLE');
    const data = [...body.matchAll(/<data\b([^>]*)\/>/g)].map(([, a]) => a.replace(/\s+/g, ' ').trim());
    expect(data).toEqual(['android:scheme="https" android:host="cardipaw.com" android:path="/share/"']);
    // An exact path (the trailing slash is the directory page the website serves): the router uses hash routing, so a prefix or "/" would claim every link.
    expect(body).not.toMatch(/pathPrefix|pathPattern|pathAdvancedPattern/);
  });

  it('serves an assetlinks.json for the app id and the release key', () => {
    const config = read('capacitor.config.ts');
    const appId = config.match(/appId:\s*'([^']+)'/)![1];
    const links = JSON.parse(read('public/.well-known/assetlinks.json'));
    expect(links).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: appId,
          sha256_cert_fingerprints: [RELEASE_FINGERPRINT],
        },
      },
    ]);
  });
});
