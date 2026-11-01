import { describe, expect, it } from 'vitest';
import { formatVersion, isNewer, parseVersion, releaseTagUrl, releaseVersion } from './version';

describe('parseVersion', () => {
  it('parses X.Y.Z with or without a leading v', () => {
    expect(parseVersion('1.10.0')).toEqual([1, 10, 0]);
    expect(parseVersion('v2.0.13')).toEqual([2, 0, 13]);
  });

  it('rejects anything but a plain release version', () => {
    for (const text of [
      '1.2',
      '1.2.3.4',
      '01.2.3',
      '1.2.3-beta.1',
      '1.2.3+build',
      ' 1.2.3',
      'V1.2.3',
      '',
      'latest',
    ]) {
      expect(parseVersion(text), text).toBeNull();
    }
  });

  it('rejects parts beyond the safe integer range', () => {
    expect(parseVersion('1.2.99999999999999999')).toBeNull();
  });
});

describe('isNewer', () => {
  it('compares numerically, major first', () => {
    expect(isNewer([1, 10, 0], [1, 9, 0])).toBe(true);
    expect(isNewer([2, 0, 0], [1, 99, 99])).toBe(true);
    expect(isNewer([1, 2, 4], [1, 2, 3])).toBe(true);
    expect(isNewer([1, 9, 9], [1, 10, 0])).toBe(false);
  });

  it('does not call the same version newer', () => {
    expect(isNewer([1, 2, 3], [1, 2, 3])).toBe(false);
  });
});

describe('releaseVersion', () => {
  it('treats a local or test build as no release', () => {
    expect(releaseVersion('0.0.0')).toBeNull();
    expect(releaseVersion('0.0.0-test')).toBeNull();
    expect(releaseVersion('garbage')).toBeNull();
    expect(releaseVersion('0.1.0')).toEqual([0, 1, 0]);
  });
});

it('builds the release page URL from the numbers', () => {
  expect(formatVersion([1, 10, 0])).toBe('1.10.0');
  expect(releaseTagUrl([1, 10, 0])).toBe(
    'https://github.com/wesleyegbertsen/CardiPaw/releases/tag/v1.10.0',
  );
});
