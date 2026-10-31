import { describe, expect, it, vi } from 'vitest';
import { cleanUpExports } from '../services/nativeFile';
import { mockNative } from '../test/native';
import { cleanUpOldExports } from './exportCleanup';

vi.mock('../services/nativeFile', () => ({ cleanUpExports: vi.fn(async () => {}) }));

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
