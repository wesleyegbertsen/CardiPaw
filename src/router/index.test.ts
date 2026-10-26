import { beforeEach, describe, expect, it, vi } from 'vitest';
import { router, routes } from './index';

// A deploy that removed the hashed chunk: the dynamic import rejects.
vi.mock('../views/SettingsView.vue', () => {
  throw new Error('chunk 404');
});

const RELOAD_KEY = 'cardipaw-chunk-reload-at';

function spyLocation() {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  return { replace, reload };
}

async function openSettings() {
  await router.push('/settings').catch(() => {});
}

describe('router', () => {
  beforeEach(async () => {
    sessionStorage.clear();
    await router.push('/');
  });

  it('resolves every route by name with its params filled in', () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const params = Object.fromEntries([...r.path.matchAll(/:(\w+)/g)].map((m) => [m[1], 'x']));
      const resolved = router.resolve({ name: r.name, params });
      expect(resolved.name).toBe(r.name);
      expect(resolved.matched).toHaveLength(1);
    }
  });

  describe('when a view chunk fails to load', () => {
    beforeEach(() => {
      vi.stubEnv('PROD', true);
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    });

    it('rejects the navigation with a ViewChunkError', async () => {
      spyLocation();
      await expect(router.push('/settings')).rejects.toMatchObject({ name: 'ViewChunkError' });
    });

    it('reloads once at the target route, then not again within the cooldown', async () => {
      const { replace, reload } = spyLocation();
      await openSettings();
      expect(replace).toHaveBeenCalledWith('#/settings');
      expect(reload).toHaveBeenCalledTimes(1);
      expect(Number(sessionStorage.getItem(RELOAD_KEY))).toBeGreaterThan(0);

      await router.push('/');
      await openSettings();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads again once the cooldown has passed', async () => {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 60_000));
      const { reload } = spyLocation();
      await openSettings();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload within the cooldown of an earlier reload', async () => {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      const { reload } = spyLocation();
      await openSettings();
      expect(reload).not.toHaveBeenCalled();
    });

    it('does not reload in development', async () => {
      vi.stubEnv('PROD', false);
      const { reload } = spyLocation();
      await openSettings();
      expect(reload).not.toHaveBeenCalled();
    });

    it('does not reload while offline', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const { reload } = spyLocation();
      await openSettings();
      expect(reload).not.toHaveBeenCalled();
    });

    it('does not reload when sessionStorage is unavailable', async () => {
      vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const { reload } = spyLocation();
      await openSettings();
      expect(reload).not.toHaveBeenCalled();
    });
  });

  it('does not reload for errors other than a failed chunk', async () => {
    vi.stubEnv('PROD', true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { reload } = spyLocation();
    const remove = router.beforeEach((to) => {
      if (to.name === 'pet') throw new Error('guard failed');
    });
    try {
      await expect(router.push('/pets/x')).rejects.toThrow('guard failed');
    } finally {
      remove();
    }
    expect(reload).not.toHaveBeenCalled();
  });
});
