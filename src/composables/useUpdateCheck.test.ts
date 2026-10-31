import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockStorage } from '../test/blockStorage';
import { mockNative } from '../test/native';
import { deferred } from '../test/deferred';
import type { Version } from '../utils/version';

vi.mock('../services/githubRelease', () => ({ fetchLatestRelease: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-05-01T12:00:00Z').getTime();

// The setting and the state are read once, when the module is first imported.
async function load({ latest = [1, 3, 0] as Version | null } = {}) {
  vi.resetModules();
  const { fetchLatestRelease } = await import('../services/githubRelease');
  // The mocked module outlives resetModules, so its spy is shared: reset it per load.
  const fetchLatest = vi.mocked(fetchLatestRelease).mockReset().mockResolvedValue(latest);
  const module = await import('./useUpdateCheck');
  return { ...module, fetchLatest, check: module.useUpdateCheck() };
}

const savedState = () => JSON.parse(localStorage.getItem('cardipaw-update-state') ?? '{}');

describe('useUpdateCheck', () => {
  beforeEach(() => {
    localStorage.clear();
    // Tests run as 0.0.0-test (vitest.config.ts), which is not a release.
    vi.stubGlobal('__APP_VERSION__', '1.2.0');
    mockNative();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('is off by default and asks nothing', async () => {
    const { checkIfDue, fetchLatest, check } = await load();
    await checkIfDue();
    expect(check.enabled.value).toBe(false);
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it('asks nothing on the website or in a local build', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    mockNative(false);
    const web = await load();
    await web.checkIfDue();
    expect(web.fetchLatest).not.toHaveBeenCalled();

    mockNative(true);
    vi.stubGlobal('__APP_VERSION__', '0.0.0');
    const local = await load();
    await local.checkIfDue();
    expect(local.fetchLatest).not.toHaveBeenCalled();
  });

  it('offers nothing on the website, even with a newer release saved', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    localStorage.setItem(
      'cardipaw-update-state',
      JSON.stringify({ lastCheck: NOW, latest: '1.3.0' }),
    );
    mockNative(false);
    const { check } = await load();
    expect(check.available.value).toBeNull();
    expect(check.showNotice.value).toBe(false);
  });

  it('turning it on checks right away and offers a newer release', async () => {
    const { fetchLatest, check } = await load();
    check.setEnabled(true);
    await vi.waitFor(() => expect(check.available.value).toEqual([1, 3, 0]));
    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(check.showNotice.value).toBe(true);
    expect(localStorage.getItem('cardipaw-update-check')).toBe('1');
  });

  it('checks at most once a day, and again when the clock was turned back', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    const { checkIfDue, fetchLatest } = await load();
    await checkIfDue(NOW);
    await checkIfDue(NOW + DAY - 1);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    await checkIfDue(NOW + DAY);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    await checkIfDue(NOW);
    expect(fetchLatest).toHaveBeenCalledTimes(3);
  });

  it('saves the check time before asking, so a failure also waits a day', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    const { checkIfDue, fetchLatest, check } = await load({ latest: null });
    let savedWhenAsked: unknown;
    fetchLatest.mockImplementation(async () => {
      savedWhenAsked = savedState().lastCheck;
      return null;
    });
    await checkIfDue();
    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(savedWhenAsked).toBe(NOW);
    expect(savedState()).toEqual({ lastCheck: NOW });
    expect(check.available.value).toBeNull();
    const again = await load({ latest: null }); // a restart reads the saved time
    await again.checkIfDue(NOW + DAY - 1);
    expect(again.fetchLatest).not.toHaveBeenCalled();
  });

  it('asks once when two checks overlap', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    const { checkIfDue, fetchLatest } = await load();
    const answer = deferred<Version | null>();
    fetchLatest.mockReturnValue(answer.promise);
    const first = checkIfDue(NOW);
    // A day later would pass the daily limit: only the pending check stops a second request.
    const second = checkIfDue(NOW + DAY);
    answer.resolve([1, 3, 0]);
    await Promise.all([first, second]);
    expect(fetchLatest).toHaveBeenCalledOnce();
  });

  it('offers nothing for the same or an older release', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    for (const latest of [
      [1, 2, 0],
      [1, 1, 9],
    ] as Version[]) {
      localStorage.removeItem('cardipaw-update-state');
      const { checkIfDue, check } = await load({ latest });
      await checkIfDue();
      expect(check.available.value).toBeNull();
      expect(check.showNotice.value).toBe(false);
    }
  });

  it('turning it off hides the offer', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    localStorage.setItem(
      'cardipaw-update-state',
      JSON.stringify({ lastCheck: NOW, latest: '1.3.0' }),
    );
    const { check } = await load();
    expect(check.available.value).toEqual([1, 3, 0]);
    check.setEnabled(false);
    expect(check.available.value).toBeNull();
    expect(localStorage.getItem('cardipaw-update-check')).toBe('0');
  });

  it('keeps a dismissed release hidden after a restart, but shows a later one', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    localStorage.setItem(
      'cardipaw-update-state',
      JSON.stringify({ lastCheck: NOW, latest: '1.3.0' }),
    );
    const { check } = await load();
    check.dismiss();
    expect(check.showNotice.value).toBe(false);
    expect((await load()).check.showNotice.value).toBe(false);

    const later = await load({ latest: [1, 4, 0] });
    await later.checkIfDue(NOW + DAY);
    expect(later.check.showNotice.value).toBe(true);
  });

  it('ignores damaged saved state', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    for (const saved of [
      'not json',
      '[]',
      'null',
      '{"lastCheck":"x","latest":"<b>9</b>","dismissed":5}',
    ]) {
      localStorage.setItem('cardipaw-update-state', saved);
      const { checkIfDue, fetchLatest, check } = await load({ latest: null });
      expect(check.available.value, saved).toBeNull();
      await checkIfDue();
      expect(fetchLatest, saved).toHaveBeenCalledOnce();
    }
  });

  it('stays off when site data is blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    blockStorage();
    const { checkIfDue, fetchLatest, check } = await load();
    await checkIfDue();
    expect(check.enabled.value).toBe(false);
    expect(fetchLatest).not.toHaveBeenCalled();
  });
});
