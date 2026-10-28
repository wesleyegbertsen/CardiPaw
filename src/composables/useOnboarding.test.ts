import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockStorage } from '../test/blockStorage';

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

  it('loads and marks seen for this session when site data is blocked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    blockStorage();
    const useOnboarding = await load();
    const { hasSeenOnboarding, markSeen } = useOnboarding();
    expect(hasSeenOnboarding.value).toBe(false);
    markSeen();
    expect(hasSeenOnboarding.value).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not save'), expect.any(DOMException));
  });
});
