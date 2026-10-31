// Checks, signs and verifies the release APK. CI's smoke test (ci.yml) and the release
// (android-release.yml) both run it, so every PR exercises the code that signs releases.
// Node built-ins only: the release's signing job installs no npm dependencies.
// sign and verify run the SDK's apksigner and zipalign directly, so they need Linux or
// macOS (on Windows apksigner is a .bat); check-version runs anywhere.
// Usage:
//   node scripts/android-apk.mjs check-version <output-metadata.json> <version>
//   node scripts/android-apk.mjs sign <unsigned.apk> <signed.apk>
//       env: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_HOME
//   node scripts/android-apk.mjs verify <signed.apk>
//       env: ANDROID_CERT_SHA256, ANDROID_HOME

import { execFileSync } from 'child_process';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SIGNING_ENV,
  checkApksignerOutput,
  checkOutputMetadata,
  decodeKeystoreBase64,
  missingEnv,
  normalizeFingerprint,
  pickBuildTools,
} from './android-apk-lib.mjs';

function buildTool(name) {
  const sdk = process.env.ANDROID_HOME;
  if (!sdk) throw new Error('ANDROID_HOME is not set: point it at the Android SDK');
  const version = pickBuildTools(readdirSync(join(sdk, 'build-tools')));
  console.log(`Using ${name} from build-tools ${version}`);
  return join(sdk, 'build-tools', version, name);
}

// Returns stdout. stdin is closed, so a password prompt fails instead of hanging the job.
// On failure the tool's stdout is printed too: zipalign -c reports there.
function run(tool, args) {
  try {
    return execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (err) {
    if (err.stdout) console.log(err.stdout);
    const why = err.code === 'ENOENT' ? 'not found' : `exit ${err.status ?? err.signal}`;
    throw new Error(`${tool} ${args[0]} failed (${why})`);
  }
}

function fail(problems) {
  if (problems.length) throw new Error(problems.join('\n'));
}

function checkVersion(metadataPath, version) {
  const meta = JSON.parse(readFileSync(metadataPath, 'utf8'));
  console.log(meta.elements);
  fail(checkOutputMetadata(meta, version));
  console.log(`versionCode and versionName match ${version}`);
}

function sign(input, output) {
  const missing = missingEnv(process.env, SIGNING_ENV);
  if (missing.length) {
    throw new Error(`Release signing needs: ${missing.join(', ')} (see README, "Release signing")`);
  }
  const keystore = decodeKeystoreBase64(process.env.ANDROID_KEYSTORE_BASE64);
  const dir = mkdtempSync(join(tmpdir(), 'cardipaw-sign-'));
  try {
    const keystorePath = join(dir, 'release.keystore');
    writeFileSync(keystorePath, keystore, { mode: 0o600 });
    // AGP's unsigned output is already zip-aligned (verify checks it), and apksigner keeps that.
    // Passwords are read from the environment, never put on the command line. A PKCS12
    // keystore (keytool's default) uses the store password for the key too.
    run(buildTool('apksigner'), [
      'sign',
      '--ks',
      keystorePath,
      '--ks-key-alias',
      process.env.ANDROID_KEY_ALIAS,
      '--ks-pass',
      'env:ANDROID_KEYSTORE_PASSWORD',
      '--key-pass',
      'env:ANDROID_KEYSTORE_PASSWORD',
      '--out',
      output,
      // v2 for Android 7-8, v3 for 9+ (a later key rotation needs it); v1 is unneeded at
      // minSdk 24, and v4 would only add a .idsig file next to the APK.
      '--v1-signing-enabled',
      'false',
      '--v2-signing-enabled',
      'true',
      '--v3-signing-enabled',
      'true',
      '--v4-signing-enabled',
      'false',
      input,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`Signed ${output}`);
}

function verify(apk) {
  const expected = normalizeFingerprint(process.env.ANDROID_CERT_SHA256, 'ANDROID_CERT_SHA256');
  run(buildTool('zipalign'), ['-c', '-P', '16', '4', apk]);
  const output = run(buildTool('apksigner'), ['verify', '--verbose', '--print-certs', apk]);
  console.log(output);
  fail(checkApksignerOutput(output, expected));
  console.log(`Signing certificate SHA-256 matches ANDROID_CERT_SHA256 (${expected})`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `cert-sha256=${expected}\n`);
  }
}

const COMMANDS = { 'check-version': [checkVersion, 2], sign: [sign, 2], verify: [verify, 1] };
const [command, ...args] = process.argv.slice(2);
const entry = COMMANDS[command];
if (!entry || args.length !== entry[1]) {
  console.error(
    'Usage: node scripts/android-apk.mjs check-version <output-metadata.json> <version>\n' +
      '       node scripts/android-apk.mjs sign <unsigned.apk> <signed.apk>\n' +
      '       node scripts/android-apk.mjs verify <signed.apk>',
  );
  process.exit(1);
}
try {
  entry[0](...args);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
