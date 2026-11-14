import { describe, expect, it } from 'vitest';
import { isNative, publicShareUrl } from './platform';
import { mockNative } from '../test/native';

describe('platform', () => {
  it('is not native on the website', () => {
    expect(isNative()).toBe(false);
  });
  it('is native inside the app', () => {
    mockNative();
    expect(isNative()).toBe(true);
  });
  it('restores after a test (restoreMocks)', () => {
    expect(isNative()).toBe(false);
  });
  it('builds share links on the current origin on the website', () => {
    expect(publicShareUrl('x')).toBe(`${window.location.origin}/share#d=x`);
  });
  it('builds share links on cardipaw.com in the app', () => {
    mockNative();
    expect(publicShareUrl('x')).toBe('https://cardipaw.com/share#d=x');
  });
});
