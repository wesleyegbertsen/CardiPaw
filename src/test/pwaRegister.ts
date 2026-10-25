import { ref } from 'vue';

/**
 * Stand-in for `virtual:pwa-register/vue`, which only exists when the PWA plugin runs
 * (vitest.config.ts aliases it here). Tests that need other behaviour `vi.mock` it.
 */
export function useRegisterSW(_options?: unknown) {
  return {
    offlineReady: ref(false),
    needRefresh: ref(false),
    updateServiceWorker: async (_reload?: boolean) => {},
  };
}
