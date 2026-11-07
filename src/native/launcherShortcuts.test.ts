import { describe, expect, it, vi } from 'vitest';
import { registerPlugin } from '@capacitor/core';

// The spread keeps the rest of Capacitor real.
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: vi.fn(() => ({ setShortcuts: vi.fn(), addListener: vi.fn() })),
}));

describe('LauncherShortcuts', () => {
  it('is the app-local plugin that MainActivity registers', async () => {
    // Imported here: restoreMocks clears the calls made before each test.
    await import('./launcherShortcuts');
    // The Java side's @CapacitorPlugin name; androidResources.test.ts checks the two match.
    expect(registerPlugin).toHaveBeenCalledExactlyOnceWith('LauncherShortcuts');
  });
});
