import { parseVersion, type Version } from '../utils/version';

// Unauthenticated: 60 requests an hour per IP, plenty for one check a day.
const LATEST_RELEASE_API = 'https://api.github.com/repos/wesleyegbertsen/CardiPaw/releases/latest';
const TIMEOUT_MS = 10_000;

/**
 * The newest published release on GitHub, or null when it can't be had (offline, rate
 * limited, an unexpected answer). Never throws: a failed check shows nothing.
 */
export async function fetchLatestRelease(): Promise<Version | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Accept is a CORS-safelisted header, so this is a simple request without a preflight.
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const { tag_name: tag, draft, prerelease } = body as Record<string, unknown>;
    // releases/latest never returns these, but they must never be offered.
    if (draft === true || prerelease === true || typeof tag !== 'string') return null;
    return parseVersion(tag);
  } catch (e) {
    console.warn('Checking for a newer release failed', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
