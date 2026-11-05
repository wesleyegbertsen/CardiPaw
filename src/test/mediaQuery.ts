import { vi } from 'vitest';

/**
 * Stands in for window.matchMedia: every query starts as `matches`, and `set` changes it
 * and fires `change` at the listeners still attached (a rotation, in the tests).
 */
export function fakeMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const state = { matches };
  const list = {
    get matches() {
      return state.matches;
    },
    addEventListener: vi.fn((_: 'change', fn: (e: MediaQueryListEvent) => void) =>
      listeners.add(fn),
    ),
    removeEventListener: vi.fn((_: 'change', fn: (e: MediaQueryListEvent) => void) =>
      listeners.delete(fn),
    ),
  };
  const matchMedia = vi
    .spyOn(window, 'matchMedia')
    .mockReturnValue(list as unknown as MediaQueryList);
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      state.matches = next;
      for (const fn of [...listeners]) fn({ matches: next } as MediaQueryListEvent);
    },
  };
}
