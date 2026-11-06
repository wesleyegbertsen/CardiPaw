import { describe, expect, it, vi } from 'vitest';
import { registerPlugin } from '@capacitor/core';

// The spread keeps the rest of Capacitor real.
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: vi.fn(() => ({ enter: vi.fn(), exit: vi.fn() })),
}));

describe('ImmersiveMode', () => {
  it('is the app-local plugin that MainActivity registers', async () => {
    // Imported here: restoreMocks clears the calls made before each test.
    const { ImmersiveMode } = await import('./immersiveMode');
    // The Java side's @CapacitorPlugin name; androidResources.test.ts checks the two match.
    expect(registerPlugin).toHaveBeenCalledExactlyOnceWith('ImmersiveMode');
    expect(ImmersiveMode.enter).toEqual(expect.any(Function));
    expect(ImmersiveMode.exit).toEqual(expect.any(Function));
  });
});
