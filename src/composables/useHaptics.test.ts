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
    vi.mocked(Haptics.impact).mockRejectedValueOnce(new Error('no vibrator'));
    vi.mocked(Haptics.notification).mockRejectedValueOnce(new Error('no vibrator'));
    const haptics = useHaptics();
    haptics.vibrateTap();
    haptics.vibrateDone();
    await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run
  });
});
