// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useThemeStore } from './theme';

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
});
