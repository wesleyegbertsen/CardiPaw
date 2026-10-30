import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useThemeStore } from './theme';
import { blockStorage } from '../test/blockStorage';
import { SystemBars } from '@capacitor/core';
import { mockNative } from '../test/native';

// SystemBars is a plugin proxy that vi.spyOn can't patch; the real Capacitor object stays,
// so mockNative still works.
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  SystemBars: { setStyle: vi.fn(async () => {}) },
}));

const STORAGE_KEY = 'cardipaw-theme';

function prefersDark(matches: boolean) {
  return vi.spyOn(window, 'matchMedia').mockReturnValue({ matches } as MediaQueryList);
}

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    setActivePinia(createPinia());
  });

  it('follows the system preference when nothing is saved', () => {
    const matchMedia = prefersDark(true);
    const store = useThemeStore();
    store.init();
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(store.isDark).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('prefers the saved theme over the system preference', () => {
    prefersDark(true);
    localStorage.setItem(STORAGE_KEY, 'light');
    const store = useThemeStore();
    store.init();
    expect(store.isDark).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    localStorage.setItem(STORAGE_KEY, 'dark');
    prefersDark(false);
    store.init();
    expect(store.isDark).toBe(true);
  });

  it('saves and applies the toggled theme', () => {
    prefersDark(false);
    const store = useThemeStore();
    store.init();
    store.toggle();
    expect(store.isDark).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    store.toggle();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('follows the system and still toggles when site data is blocked', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prefersDark(true);
    blockStorage();
    const store = useThemeStore();
    store.init();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    store.toggle();
    expect(store.isDark).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not save'), expect.any(DOMException));
  });
});

describe('theme store, system bars', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('matches the system bar icons to the theme in the app', () => {
    mockNative();
    const setStyle = vi.mocked(SystemBars.setStyle);
    localStorage.setItem(STORAGE_KEY, 'dark');
    const store = useThemeStore();
    store.init();
    store.toggle();
    expect(setStyle.mock.calls).toEqual([[{ style: 'DARK' }], [{ style: 'LIGHT' }]]);
  });

  it('logs a failed system bar update', async () => {
    mockNative();
    const failure = new Error('no bridge');
    vi.mocked(SystemBars.setStyle).mockRejectedValueOnce(failure);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    useThemeStore().toggle();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Setting the system bar style failed', failure));
  });

  it('leaves the system bars alone on the website', () => {
    const setStyle = vi.mocked(SystemBars.setStyle);
    useThemeStore().toggle();
    expect(setStyle).not.toHaveBeenCalled();
  });
});
