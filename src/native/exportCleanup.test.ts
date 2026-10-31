import { describe, expect, it, vi } from 'vitest';
import { cleanUpExports } from '../services/nativeFile';
import { mockNative } from '../test/native';
import { cleanUpOldExports } from './exportCleanup';

// The real MAX_EXPORT_AGE_MS, so the test below pins its value.
vi.mock('../services/nativeFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/nativeFile')>()),
  cleanUpExports: vi.fn(async () => {}),
}));

describe('cleanUpOldExports', () => {
  it('deletes the exports older than an hour in the app', () => {
    mockNative();
    cleanUpOldExports();
    expect(cleanUpExports).toHaveBeenCalledExactlyOnceWith(60 * 60 * 1000);
  });

  it('does nothing on the website', () => {
    cleanUpOldExports();
    expect(cleanUpExports).not.toHaveBeenCalled();
  });
});
