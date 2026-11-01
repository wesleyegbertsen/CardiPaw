import { describe, expect, it } from 'vitest';
import { isNative, publicUrl } from './platform';
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
  it('resolves share links against the current page on the website', () => {
    expect(publicUrl('#/share?d=x')).toBe(new URL('#/share?d=x', window.location.href).href);
  });
  it('resolves share links against cardipaw.com in the app', () => {
    mockNative();
    expect(publicUrl('#/share?d=x')).toBe('https://cardipaw.com/#/share?d=x');
  });
});
