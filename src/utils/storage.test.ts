// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStorage, writeStorage } from './storage';
import { blockStorage, failStorageWrites } from '../test/blockStorage';

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('reads and writes localStorage', () => {
    expect(readStorage('k')).toBeNull();
    writeStorage('k', 'v');
    expect(readStorage('k')).toBe('v');
  });

  it('reads null and skips writes when site data is blocked', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    blockStorage();
    expect(readStorage('k')).toBeNull();
    expect(() => writeStorage('k', 'v')).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('skips a write when the quota is full', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    failStorageWrites();
    expect(() => writeStorage('k', 'v')).not.toThrow();
  });
});
