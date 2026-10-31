import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LATEST_RELEASE_API } from '../utils/version';
import { fetchLatestRelease } from './githubRelease';

const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );

describe('fetchLatestRelease', () => {
  beforeEach(() => vi.stubGlobal('fetch', fetchMock.mockReset()));
  afterEach(() => vi.useRealTimers());

  it('asks GitHub for the latest release without credentials, a referrer or a cached answer', async () => {
    reply({ tag_name: 'v1.10.0' });
    await expect(fetchLatestRelease()).resolves.toEqual([1, 10, 0]);
    // The same constant the app's Content-Security-Policy allows (src/native/csp.ts).
    expect(LATEST_RELEASE_API).toBe(
      'https://api.github.com/repos/wesleyegbertsen/CardiPaw/releases/latest',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      LATEST_RELEASE_API,
      expect.objectContaining({
        headers: { Accept: 'application/vnd.github+json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      }),
    );
  });

  it('returns null for an error status, such as the rate limit', async () => {
    for (const status of [403, 404, 429, 500]) {
      reply({ tag_name: 'v9.9.9' }, status);
      await expect(fetchLatestRelease(), String(status)).resolves.toBeNull();
    }
  });

  it('returns null for an unexpected answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const body of [
      'not json',
      null,
      [],
      {},
      { tag_name: 3 },
      { tag_name: 'v2.0.0-rc.1' },
      { tag_name: 'v2.0.0', draft: true },
      { tag_name: 'v2.0.0', prerelease: true },
    ]) {
      reply(body);
      await expect(fetchLatestRelease(), JSON.stringify(body)).resolves.toBeNull();
    }
    expect(warn).toHaveBeenCalledOnce(); // only the invalid JSON throws
  });

  it('returns null and warns when offline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchLatestRelease()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('Checking for a newer release failed', expect.any(TypeError));
  });

  it('gives up after 10 seconds', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)),
        ),
    );
    const result = fetchLatestRelease();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
  });
});
