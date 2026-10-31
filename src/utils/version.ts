/** [major, minor, patch] of a release. */
export type Version = readonly [number, number, number];

export const LATEST_RELEASE_URL = 'https://github.com/wesleyegbertsen/CardiPaw/releases/latest';

// Plain X.Y.Z (optionally vX.Y.Z, as in release tags): no prerelease or build suffix.
const RELEASE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(text: string): Version | null {
  const match = RELEASE.exec(text);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return [major, minor, patch];
}

export function formatVersion([major, minor, patch]: Version): string {
  return `${major}.${minor}.${patch}`;
}

/** Numeric, so 1.10.0 is newer than 1.9.0. */
export function isNewer(candidate: Version, current: Version): boolean {
  for (let i = 0; i < 3; i++) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i];
  }
  return false;
}

/** The version as a release, or null for a local build (0.0.0) or anything else. */
export function releaseVersion(text: string): Version | null {
  const version = parseVersion(text);
  return version && version.some((part) => part > 0) ? version : null;
}

/** The GitHub page of a release, built from the numbers so no outside text ends up in it. */
export function releaseTagUrl(version: Version): string {
  return `https://github.com/wesleyegbertsen/CardiPaw/releases/tag/v${formatVersion(version)}`;
}
