import { describe, expect, it } from 'vitest';
import {
  checkApksignerOutput,
  checkOutputMetadata,
  decodeKeystoreBase64,
  expectedVersionCode,
  missingEnv,
  normalizeFingerprint,
  pickBuildTools,
} from './android-apk-lib.mjs';

const DIGEST = '476f22654d2a0ec0de670b80f466bab0fb0ec6c356ab0f77f9491a9e47f18ad3';
// Real `apksigner verify --verbose --print-certs` output (build-tools 37.0.0) for a release APK
// that `android-apk.mjs sign` signed with a throwaway key.
const VERIFIED_37 = `Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v3.2 scheme (APK Signature Scheme v3.2): false
Verified using v4 scheme (APK Signature Scheme v4): false
Verified for SourceStamp: false
Number of signers: 1
V3.0 Signer: certificate DN: CN=cardipaw-ci-smoke
V3.0 Signer: certificate SHA-256 digest: ${DIGEST}
V3.0 Signer: certificate SHA-1 digest: 50f44d887970de8d25192b707543a69014a8f547
V3.0 Signer: certificate MD5 digest: b0c8f28ac89c82b86d06b47e23060452
V3.0 Signer: key algorithm: RSA
V3.0 Signer: key size (bits): 2048
V3.0 Signer: public key SHA-256 digest: c986d93f8f6ccccc33e8603613dc6141f5286cf8d845ae570fddc07bf6065ae2
V3.0 Signer: public key SHA-1 digest: 3aab0b14216abcef25b95236124ee568cfe856be
V3.0 Signer: public key MD5 digest: 143d304231147878f2d9997aca642ecb
`;
// build-tools 36.0.0 printed the same APK without the v3.2 line and with "Signer #1 " labels.
const VERIFIED_36 = VERIFIED_37.replace(/^.*v3\.2 scheme.*\n/m, '').replaceAll(
  'V3.0 Signer: ',
  'Signer #1 ',
);

const metadata = (apk) => ({
  version: 3,
  elements: [
    {
      type: 'SINGLE',
      versionCode: 1002003,
      versionName: '1.2.3',
      outputFile: 'app-release-unsigned.apk',
      ...apk,
    },
  ],
});

describe('expectedVersionCode', () => {
  it('is major*1e6 + minor*1e3 + patch', () => {
    expect(expectedVersionCode('1.2.3')).toBe(1002003);
    expect(expectedVersionCode('1.0.0')).toBe(1000000);
    expect(expectedVersionCode('2.999.999')).toBe(2999999);
  });

  it.each(['1.1000.0', '1.0.1000', 'v1.2.3', '1.2.3-rc.1', '1.2', '', undefined, '0.0.0'])(
    'rejects %j',
    (version) => {
      expect(() => expectedVersionCode(version)).toThrow();
    },
  );
});

describe('checkOutputMetadata', () => {
  it('accepts an unsigned APK with the expected version', () => {
    expect(checkOutputMetadata(metadata(), '1.2.3')).toEqual([]);
  });

  it('reports a wrong versionCode and versionName', () => {
    expect(checkOutputMetadata(metadata({ versionCode: 1 }), '1.2.3')).toEqual([
      'versionCode is 1, expected 1002003',
    ]);
    expect(checkOutputMetadata(metadata(), '1.2.4')).toEqual([
      'versionCode is 1002003, expected 1002004',
      'versionName is "1.2.3", expected "1.2.4"',
    ]);
  });

  it('reports an APK that Gradle signed', () => {
    const [problem] = checkOutputMetadata(metadata({ outputFile: 'app-release.apk' }), '1.2.3');
    expect(problem).toMatch(/^outputFile is "app-release.apk"/);
  });

  it('needs exactly one APK', () => {
    const one = 'expected exactly one APK in output-metadata.json';
    expect(checkOutputMetadata({ elements: [] }, '1.2.3')).toEqual([`${one}, got 0`]);
    const [apk] = metadata().elements;
    expect(checkOutputMetadata({ elements: [apk, apk] }, '1.2.3')).toEqual([`${one}, got 2`]);
    expect(checkOutputMetadata({}, '1.2.3')).toEqual([`${one}, got none`]);
  });
});

describe('normalizeFingerprint', () => {
  it("accepts keytool's upper case with colons", () => {
    const keytool = DIGEST.toUpperCase().match(/../g).join(':');
    expect(normalizeFingerprint(keytool, 'X')).toBe(DIGEST);
    expect(normalizeFingerprint(` ${DIGEST}\n`, 'X')).toBe(DIGEST);
  });

  it('rejects anything but 64 hex digits', () => {
    expect(() => normalizeFingerprint(DIGEST.slice(1), 'X')).toThrow(/64 hex digits/);
    expect(() => normalizeFingerprint(`${DIGEST.slice(1)}g`, 'X')).toThrow(/64 hex digits/);
  });

  it('names the variable to set when it is empty', () => {
    for (const value of [undefined, '', '  ']) {
      expect(() => normalizeFingerprint(value, 'ANDROID_CERT_SHA256')).toThrow(
        'ANDROID_CERT_SHA256 is empty: set the repository variable',
      );
    }
  });
});

describe('decodeKeystoreBase64', () => {
  const bytes = Buffer.from([0x30, 0x82, 0x0a, 0xff, 0x00, 0x7e, 0x3f]);
  const base64 = bytes.toString('base64');

  it('round-trips, also when wrapped with LF or CRLF', () => {
    expect(decodeKeystoreBase64(base64)).toEqual(bytes);
    expect(decodeKeystoreBase64(`${base64.slice(0, 4)}\r\n${base64.slice(4)}\n`)).toEqual(bytes);
  });

  it('rejects certutil output without echoing it', () => {
    const certutil = `-----BEGIN CERTIFICATE-----\r\n${base64}\r\n-----END CERTIFICATE-----\r\n`;
    expect(() => decodeKeystoreBase64(certutil)).toThrow(/not `certutil -encode`/);
    expect(() => decodeKeystoreBase64(certutil)).not.toThrow(base64);
  });

  it('rejects truncated base64', () => {
    expect(() => decodeKeystoreBase64(base64.slice(0, -1))).toThrow(/not plain base64/);
  });
});

describe('pickBuildTools', () => {
  it('picks the newest stable version, compared numerically', () => {
    expect(pickBuildTools(['34.0.0', '37.0.0', '36.1.0', '35.0.1', '38.0.0-rc1'])).toBe('37.0.0');
    expect(pickBuildTools(['35.0.0', '35.0.10', '35.0.9'])).toBe('35.0.10');
  });

  it('fails without build-tools 35 or newer', () => {
    expect(() => pickBuildTools([])).toThrow('No Android build-tools found (saw: nothing)');
    expect(() => pickBuildTools(['34.0.0'])).toThrow('Need Android build-tools 35+');
  });
});

describe('checkApksignerOutput', () => {
  it.each([
    ['37', VERIFIED_37],
    ['36', VERIFIED_36],
  ])('accepts build-tools %s output for the expected certificate', (_, output) => {
    expect(checkApksignerOutput(output, DIGEST)).toEqual([]);
    expect(checkApksignerOutput(output.replaceAll('\n', '\r\n'), DIGEST)).toEqual([]);
  });

  it.each([
    ['37', VERIFIED_37],
    ['36', VERIFIED_36],
  ])('reports a different certificate in build-tools %s output', (_, output) => {
    const [problem, ...rest] = checkApksignerOutput(output, 'f'.repeat(64));
    expect(problem).toMatch(`is not ANDROID_CERT_SHA256 (${'f'.repeat(64)})`);
    expect(problem).toContain(DIGEST);
    expect(rest).toEqual([]);
  });

  it.each([
    ['no "Verifies"', (o) => o.replace('Verifies\n', 'DOES NOT VERIFY\n')],
    ['v2 not verified', (o) => o.replace('Scheme v2): true', 'Scheme v2): false')],
    ['v3 not verified', (o) => o.replace('Scheme v3): true', 'Scheme v3): false')],
    ['two signers', (o) => o.replace('Number of signers: 1', 'Number of signers: 2')],
    ['no digest line', (o) => o.replace(/^.*certificate SHA-256 digest.*\n/m, '')],
    [
      'a second, different digest',
      (o) => `${o}V2 Signer: certificate SHA-256 digest: ${'e'.repeat(64)}\n`,
    ],
    ['an upper-case digest', (o) => o.replace(DIGEST, DIGEST.toUpperCase())],
  ])('fails closed on %s', (_, edit) => {
    const output = edit(VERIFIED_37);
    expect(output).not.toBe(VERIFIED_37);
    expect(checkApksignerOutput(output, DIGEST)).toHaveLength(1);
  });
});

describe('missingEnv', () => {
  it('counts unset, empty and blank values as missing', () => {
    const env = { A: 'x', B: '', C: '  ' };
    expect(missingEnv(env, ['A', 'B', 'C', 'D'])).toEqual(['B', 'C', 'D']);
  });
});
