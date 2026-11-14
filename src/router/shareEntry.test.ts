import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from 'vue';

async function loadRouterAt(url: string) {
  window.history.replaceState(null, '', url);
  vi.resetModules();
  const { router } = await import('./index');
  createApp({ render: () => null }).use(router); // starts the initial navigation
  await router.isReady();
  return router;
}

describe('router entry', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('opens /share#d= on the share view and moves the page to the hash route', async () => {
    const router = await loadRouterAt('/share#d=abc');
    expect(window.location.pathname).toBe('/');
    expect(router.currentRoute.value.name).toBe('share');
    expect(router.currentRoute.value.query.d).toBe('abc');
  });

  it('opens /share/#d= the same way (the page the website serves)', async () => {
    const router = await loadRouterAt('/share/#d=abc');
    expect(window.location.pathname).toBe('/');
    expect(router.currentRoute.value.name).toBe('share');
    expect(router.currentRoute.value.query.d).toBe('abc');
  });

  it('leaves legacy #/share?d= links alone', async () => {
    const router = await loadRouterAt('/#/share?d=old');
    expect(router.currentRoute.value.name).toBe('share');
    expect(router.currentRoute.value.query.d).toBe('old');
  });
});
