import { afterEach, describe, expect, it, vi } from 'vitest';
import { Haptics } from '@capacitor/haptics';
import { useHaptics } from './useHaptics';
import { mockNative } from '../test/native';

vi.mock('@capacitor/haptics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/haptics')>()),
  Haptics: { impact: vi.fn(async () => {}), notification: vi.fn(async () => {}) },
}));

describe('useHaptics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing where vibration is unsupported', () => {
    vi.stubGlobal('navigator', {});
    const haptics = useHaptics();
    expect(haptics.isSupported).toBe(false);
    expect(() => {
      haptics.vibrateTap();
      haptics.vibrateDone();
    }).not.toThrow();
  });

  it('does nothing without a navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(useHaptics().isSupported).toBe(false);
  });

  it('vibrates briefly for a tap and in a pattern when done', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const haptics = useHaptics();
    expect(haptics.isSupported).toBe(true);
    haptics.vibrateTap();
    haptics.vibrateDone();
    expect(vibrate.mock.calls).toEqual([[30], [[80, 60, 80]]]);
  });
});

describe('useHaptics in the app', () => {
  it('vibrates through the Haptics plugin, not the Vibration API', () => {
    mockNative();
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const haptics = useHaptics();
    expect(haptics.isSupported).toBe(true);
    haptics.vibrateTap();
    haptics.vibrateDone();
    expect(Haptics.impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(Haptics.notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('ignores a failed vibration', async () => {
    mockNative();
    // Plain functions, not vi.fn(): a spy marks the promises it returns as handled, which
    // would hide a missing .catch().
    const { impact, notification } = Haptics;
    const fail = () => Promise.reject(new Error('no vibrator'));
    Haptics.impact = fail;
    Haptics.notification = fail;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const haptics = useHaptics();
      haptics.vibrateTap();
      haptics.vibrateDone();
      // Node reports unhandled rejections once the microtask queue drains.
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      Haptics.impact = impact;
      Haptics.notification = notification;
    }
  });
});
