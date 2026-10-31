// Pure checks for scripts/android-apk.mjs. No I/O, so scripts/android-apk-lib.test.mjs
// can test them without an Android SDK.

export const SIGNING_ENV = [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
];
// zipalign -P (page-align native libraries) arrived in build-tools 35.
const MIN_BUILD_TOOLS_MAJOR = 35;
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Names whose value is unset or blank. */
export function missingEnv(env, names) {
  return names.filter((name) => !env[name]?.trim());
}

/** major*1e6 + minor*1e3 + patch, computed independently of android/app/build.gradle. */
export function expectedVersionCode(version) {
  const match = RELEASE_VERSION.exec(version ?? '');
  if (!match) throw new Error(`Expected a release version like 1.2.3, got "${version}"`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 999 || patch > 999) {
    throw new Error(`versionCode needs minor and patch <= 999, got ${version}`);
  }
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (code < 1) throw new Error(`A release can't be ${version}: Android needs versionCode >= 1`);
  return code;
}

/** Problems with Gradle's output-metadata.json for an unsigned release build; [] when fine. */
export function checkOutputMetadata(meta, version) {
  const elements = meta?.elements;
  if (!Array.isArray(elements) || elements.length !== 1) {
    return [`expected exactly one APK in output-metadata.json, got ${elements?.length ?? 'none'}`];
  }
  const [apk] = elements;
  const code = expectedVersionCode(version);
  const problems = [];
  if (apk.versionCode !== code) {
    problems.push(`versionCode is ${apk.versionCode}, expected ${code}`);
  }
  if (apk.versionName !== version) {
    problems.push(`versionName is "${apk.versionName}", expected "${version}"`);
  }
  if (apk.outputFile !== 'app-release-unsigned.apk') {
    problems.push(
      `outputFile is "${apk.outputFile}", expected "app-release-unsigned.apk": Gradle must not ` +
        'sign release builds, CI signs them with apksigner (scripts/android-apk.mjs sign)',
    );
  }
  return problems;
}

/** Lower-case hex without separators; accepts keytool's "AB:CD:…" form. */
export function normalizeFingerprint(value, name) {
  if (!value?.trim()) {
    throw new Error(
      `${name} is empty: set the repository variable (see README, "Release signing")`,
    );
  }
  const hex = value.replace(/[\s:]/g, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(
      `${name} must be a SHA-256 fingerprint (64 hex digits, colons allowed), got "${value}"`,
    );
  }
  return hex;
}

/** Strict base64 to bytes. Never echoes the value: it is the keystore. */
export function decodeKeystoreBase64(value) {
  const compact = value.replace(/\s/g, '');
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error(
      'ANDROID_KEYSTORE_BASE64 is not plain base64. Create it with ' +
        '`base64 -w0 cardipaw-release.jks` (not `certutil -encode`, which adds header lines).',
    );
  }
  return Buffer.from(compact, 'base64');
}

/** Newest stable build-tools directory name, e.g. "37.0.0". */
export function pickBuildTools(names) {
  const versions = names
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .map((name) => ({ name, parts: name.split('.').map(Number) }))
    .sort((a, b) => a.parts[0] - b.parts[0] || a.parts[1] - b.parts[1] || a.parts[2] - b.parts[2]);
  const newest = versions.at(-1);
  if (!newest) {
    throw new Error(`No Android build-tools found (saw: ${names.join(', ') || 'nothing'})`);
  }
  if (newest.parts[0] < MIN_BUILD_TOOLS_MAJOR) {
    throw new Error(`Need Android build-tools ${MIN_BUILD_TOOLS_MAJOR}+, newest is ${newest.name}`);
  }
  return newest.name;
}

/**
 * Problems with `apksigner verify --verbose --print-certs` output; [] when it matches. Fails
 * closed. The label before the digest changed in build-tools 37 ("Signer #1 certificate …"
 * became "V3.0 Signer: certificate …"), so every "certificate SHA-256 digest" line counts,
 * whatever its label, and each must be the expected one.
 */
export function checkApksignerOutput(output, expected) {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const problems = [];
  if (!lines.includes('Verifies')) problems.push('apksigner did not report "Verifies"');
  for (const scheme of ['v2', 'v3']) {
    const line = `Verified using ${scheme} scheme (APK Signature Scheme ${scheme}): true`;
    if (!lines.includes(line)) problems.push(`APK Signature Scheme ${scheme} is not verified`);
  }
  if (!lines.includes('Number of signers: 1')) problems.push('expected exactly one signer');
  const digestLines = lines.filter((line) => line.includes('certificate SHA-256 digest:'));
  if (digestLines.length === 0) problems.push('apksigner printed no certificate SHA-256 digest');
  for (const line of digestLines) {
    const digest = /certificate SHA-256 digest: ([0-9a-f]{64})$/.exec(line)?.[1];
    if (digest !== expected) {
      problems.push(`signing certificate is not ANDROID_CERT_SHA256 (${expected}): "${line}"`);
    }
  }
  return problems;
}
