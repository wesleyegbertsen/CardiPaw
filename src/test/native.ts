import { vi } from 'vitest';
import { Capacitor } from '@capacitor/core';

/** Makes isNative() (src/utils/platform.ts) report the app; restoreMocks undoes it after each test. */
export function mockNative(native = true) {
  return vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
}
