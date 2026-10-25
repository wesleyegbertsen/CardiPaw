import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHaptics } from './useHaptics';

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
