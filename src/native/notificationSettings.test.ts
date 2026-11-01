import { describe, expect, it, vi } from 'vitest';
import { registerPlugin } from '@capacitor/core';

// The spread keeps the rest of Capacitor real.
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: vi.fn(() => ({ open: vi.fn() })),
}));

describe('NotificationSettings', () => {
  it('is the app-local plugin that MainActivity registers', async () => {
    // Imported here: restoreMocks clears the calls made before each test.
    const { NotificationSettings } = await import('./notificationSettings');
    // The Java side's @CapacitorPlugin name; androidResources.test.ts checks the two match.
    expect(registerPlugin).toHaveBeenCalledExactlyOnceWith('NotificationSettings');
    expect(NotificationSettings.open).toEqual(expect.any(Function));
  });
});
