import { describe, expect, it, vi } from 'vitest';
import { errorCode, failureOf } from './backupFolder';

// The spread keeps the rest of Capacitor real.
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: vi.fn(() => ({ pickFolder: vi.fn() })),
}));

describe('BackupFolder', () => {
  it('is the app-local plugin that MainActivity registers', async () => {
    // Loaded afresh here: restoreMocks clears the calls the import at the top made.
    vi.resetModules();
    const { registerPlugin } = await import('@capacitor/core');
    const { BackupFolder } = await import('./backupFolder');
    // The Java side's @CapacitorPlugin name; androidResources.test.ts checks the two match.
    expect(registerPlugin).toHaveBeenCalledExactlyOnceWith('BackupFolder');
    expect(BackupFolder.pickFolder).toEqual(expect.any(Function));
  });
});

describe('failureOf', () => {
  it.each([
    ['PERMISSION_REVOKED', 'revoked'],
    ['FOLDER_MISSING', 'missing'],
    ['STORAGE_FULL', 'full'],
    ['WRITE_FAILED', 'failed'],
    ['INVALID_NAME', 'failed'],
    ['FAILED', 'failed'],
    ['UNIMPLEMENTED', 'failed'],
  ])('maps the plugin code %s to %s', (code, failure) => {
    expect(failureOf({ code })).toBe(failure);
  });

  it.each([
    ['undefined', undefined],
    ['an Error without a code', new Error('boom')],
    ['null', null],
    ['a code that is not a string', { code: 42 }],
  ])('maps %s to failed', (_label, e) => {
    expect(errorCode(e)).toBeUndefined();
    expect(failureOf(e)).toBe('failed');
  });
});
