import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockStorage } from '../test/blockStorage';
import { mockNative } from '../test/native';
import { deferred } from '../test/deferred';
import type { Version } from '../utils/version';
import { MIN_MANUAL_INTERVAL_MS } from './useUpdateCheck';

vi.mock('../services/githubRelease', () => ({ fetchLatestRelease: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
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
    expect(await check.checkNow()).toBeNull();
    expect(check.enabled.value).toBe(false);
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it('asks nothing on the website or in a local build', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    mockNative(false);
    const web = await load();
    await web.checkIfDue();
    expect(await web.check.checkNow()).toBeNull();
    expect(web.fetchLatest).not.toHaveBeenCalled();

    mockNative(true);
    vi.stubGlobal('__APP_VERSION__', '0.0.0');
    const local = await load();
    await local.checkIfDue();
    expect(await local.check.checkNow()).toBeNull();
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

  it('finishes a check that overlaps another only once that one has finished', async () => {
    localStorage.setItem('cardipaw-update-check', '1');
    const { checkIfDue, fetchLatest } = await load();
    const answer = deferred<Version | null>();
    fetchLatest.mockReturnValue(answer.promise);
    const first = checkIfDue(NOW);
    const second = checkIfDue(NOW + DAY).then(() => savedState().latest);
    answer.resolve([1, 3, 0]);
    expect(await second).toBe('1.3.0');
    await first;
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
      '{"lastCheck":"x","lastSuccess":"y","latest":"<b>9</b>","dismissed":5}',
    ]) {
      localStorage.setItem('cardipaw-update-state', saved);
      const { checkIfDue, fetchLatest, check } = await load({ latest: null });
      expect(check.available.value, saved).toBeNull();
      expect(check.lastChecked.value, saved).toBeNull();
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

  describe('check now', () => {
    beforeEach(() => localStorage.setItem('cardipaw-update-check', '1'));

    it('asks GitHub within a day of the last check, saving the time first', async () => {
      localStorage.setItem('cardipaw-update-state', JSON.stringify({ lastCheck: NOW }));
      const { fetchLatest, check } = await load();
      let savedWhenAsked: unknown;
      fetchLatest.mockImplementation(async () => {
        savedWhenAsked = savedState().lastCheck;
        return [1, 3, 0];
      });
      await check.checkNow(NOW + MIN_MANUAL_INTERVAL_MS);
      expect(fetchLatest).toHaveBeenCalledOnce();
      expect(savedWhenAsked).toBe(NOW + MIN_MANUAL_INTERVAL_MS);
    });

    it('reports a newer release, an up-to-date app and a failure', async () => {
      for (const [latest, outcome] of [
        [[1, 3, 0], { status: 'available', version: [1, 3, 0] }],
        [[1, 2, 0], { status: 'up-to-date' }],
        [null, { status: 'failed' }],
      ] as const) {
        localStorage.removeItem('cardipaw-update-state');
        const { check } = await load({ latest: latest && [...latest] });
        expect(await check.checkNow(NOW)).toEqual(outcome);
      }
    });

    it('counts only a successful check as last checked, also after a restart', async () => {
      const { fetchLatest, check } = await load();
      expect(check.lastChecked.value).toBeNull();
      await check.checkNow(NOW);
      expect(check.lastChecked.value).toBe(NOW);
      fetchLatest.mockResolvedValue(null);
      await check.checkNow(NOW + DAY);
      expect(check.lastChecked.value).toBe(NOW);
      expect(savedState()).toMatchObject({ lastCheck: NOW + DAY, lastSuccess: NOW });
      expect((await load()).check.lastChecked.value).toBe(NOW);
    });

    it('counts a check by the previous version that found a release as successful', async () => {
      // Version 1.3.0 saved lastCheck and latest, but no lastSuccess.
      localStorage.setItem(
        'cardipaw-update-state',
        JSON.stringify({ lastCheck: NOW - HOUR, latest: '1.3.0' }),
      );
      const { fetchLatest, check } = await load();
      expect(check.lastChecked.value).toBe(NOW - HOUR);
      expect(await check.checkNow(NOW - HOUR + MIN_MANUAL_INTERVAL_MS / 2)).toEqual({
        status: 'available',
        version: [1, 3, 0],
      });
      expect(fetchLatest).not.toHaveBeenCalled();
    });

    it('counts a check by the previous version that found nothing as never checked', async () => {
      localStorage.setItem('cardipaw-update-state', JSON.stringify({ lastCheck: NOW - HOUR }));
      const { check } = await load();
      expect(check.lastChecked.value).toBeNull();
    });

    it('leaves a dismissed release dismissed', async () => {
      localStorage.setItem(
        'cardipaw-update-state',
        JSON.stringify({ lastCheck: NOW - DAY, latest: '1.3.0', dismissed: '1.3.0' }),
      );
      const { check } = await load();
      await check.checkNow(NOW);
      expect(check.showNotice.value).toBe(false);
      expect(savedState().dismissed).toBe('1.3.0');
    });

    it('repeats the last answer within a minute instead of asking again', async () => {
      const { fetchLatest, check } = await load();
      await check.checkNow(NOW);
      expect(await check.checkNow(NOW + MIN_MANUAL_INTERVAL_MS - 1)).toEqual({
        status: 'available',
        version: [1, 3, 0],
      });
      expect(fetchLatest).toHaveBeenCalledOnce();
      await check.checkNow(NOW + MIN_MANUAL_INTERVAL_MS);
      expect(fetchLatest).toHaveBeenCalledTimes(2);
    });

    it('repeats a failure within a minute, also after a restart', async () => {
      // An earlier check found 1.3.0; that answer must not stand in for the failed one.
      localStorage.setItem(
        'cardipaw-update-state',
        JSON.stringify({ lastCheck: NOW - DAY, lastSuccess: NOW - DAY, latest: '1.3.0' }),
      );
      const { check } = await load({ latest: null });
      expect(await check.checkNow(NOW)).toEqual({ status: 'failed' });
      const again = await load(); // GitHub would answer now, but a minute hasn't passed
      expect(await again.check.checkNow(NOW + MIN_MANUAL_INTERVAL_MS / 2)).toEqual({
        status: 'failed',
      });
      expect(again.fetchLatest).not.toHaveBeenCalled();
    });

    it('repeats an answer the daily check found a moment ago', async () => {
      const { checkIfDue, fetchLatest, check } = await load({ latest: [1, 2, 0] });
      await checkIfDue(NOW);
      expect(await check.checkNow(NOW + 1000)).toEqual({ status: 'up-to-date' });
      expect(fetchLatest).toHaveBeenCalledOnce();
    });

    it('waits for a check under way instead of asking again', async () => {
      const { checkIfDue, fetchLatest, check } = await load();
      const answer = deferred<Version | null>();
      fetchLatest.mockReturnValue(answer.promise);
      const daily = checkIfDue(NOW);
      // A day later would pass both limits: only the pending check stops more requests.
      const taps = [check.checkNow(NOW + DAY), check.checkNow(NOW + DAY)];
      answer.resolve([1, 3, 0]);
      await daily;
      expect(await Promise.all(taps)).toEqual([
        { status: 'available', version: [1, 3, 0] },
        { status: 'available', version: [1, 3, 0] },
      ]);
      expect(fetchLatest).toHaveBeenCalledOnce();
    });

    it('waits for a daily check that started a moment ago instead of repeating it', async () => {
      const { checkIfDue, fetchLatest, check } = await load();
      const answer = deferred<Version | null>();
      fetchLatest.mockReturnValue(answer.promise);
      const daily = checkIfDue(NOW);
      // Within a minute, but the check hasn't answered yet: there's nothing to repeat.
      const tap = check.checkNow(NOW + 1000);
      answer.resolve([1, 3, 0]);
      await daily;
      expect(await tap).toEqual({ status: 'available', version: [1, 3, 0] });
      expect(fetchLatest).toHaveBeenCalledOnce();
    });

    it('asks when the clock was turned back, then waits a minute again', async () => {
      localStorage.setItem('cardipaw-update-state', JSON.stringify({ lastCheck: NOW + DAY }));
      const { fetchLatest, check } = await load();
      await check.checkNow(NOW);
      await check.checkNow(NOW + 1000);
      expect(fetchLatest).toHaveBeenCalledOnce();
    });

    it('pushes the next daily check a day out', async () => {
      const { checkIfDue, fetchLatest, check } = await load();
      await checkIfDue(NOW);
      await check.checkNow(NOW + 2 * MIN_MANUAL_INTERVAL_MS);
      await checkIfDue(NOW + DAY);
      expect(fetchLatest).toHaveBeenCalledTimes(2);
      await checkIfDue(NOW + 2 * MIN_MANUAL_INTERVAL_MS + DAY);
      expect(fetchLatest).toHaveBeenCalledTimes(3);
    });
  });
});
