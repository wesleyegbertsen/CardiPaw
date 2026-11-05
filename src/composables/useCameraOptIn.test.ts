import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'cardipaw-camera-counting';

// The flag is read once, when the module is first imported.
async function load() {
  vi.resetModules();
  return await import('./useCameraOptIn');
}

describe('useCameraOptIn', () => {
  beforeEach(() => localStorage.clear());

  it('is off on a fresh install', async () => {
    const { useCameraOptIn } = await load();
    expect(useCameraOptIn().enabled.value).toBe(false);
  });

  it('reads the saved choice', async () => {
    localStorage.setItem(STORAGE_KEY, '1');
    const { useCameraOptIn } = await load();
    expect(useCameraOptIn().enabled.value).toBe(true);
  });

  it('saves the choice and shares it between callers', async () => {
    const { useCameraOptIn } = await load();
    const first = useCameraOptIn();
    const second = useCameraOptIn();
    first.setEnabled(true);
    expect(second.enabled.value).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
    first.setEnabled(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
  });
});

describe('isCameraSupported', () => {
  it('is false in happy-dom, which has no mediaDevices', async () => {
    const { isCameraSupported } = await load();
    expect(isCameraSupported()).toBe(false);
  });

  it('is true once navigator.mediaDevices.getUserMedia exists', async () => {
    // unstubGlobals restores happy-dom's navigator after the test.
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia: vi.fn() } }),
    );
    const { isCameraSupported } = await load();
    expect(isCameraSupported()).toBe(true);
  });
});
