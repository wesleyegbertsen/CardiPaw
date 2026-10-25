// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'cardipaw-onboarding-seen';

// The flag is read once, when the module is first imported.
async function load() {
  vi.resetModules();
  return (await import('./useOnboarding')).useOnboarding;
}

describe('useOnboarding', () => {
  beforeEach(() => localStorage.clear());

  it('starts unseen on a fresh install', async () => {
    const useOnboarding = await load();
    expect(useOnboarding().hasSeenOnboarding.value).toBe(false);
  });

  it('reads the saved flag', async () => {
    localStorage.setItem(STORAGE_KEY, '1');
    const useOnboarding = await load();
    expect(useOnboarding().hasSeenOnboarding.value).toBe(true);
  });

  it('saves the flag and shares it between callers', async () => {
    const useOnboarding = await load();
    const first = useOnboarding();
    const second = useOnboarding();
    first.markSeen();
    expect(second.hasSeenOnboarding.value).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });
});
