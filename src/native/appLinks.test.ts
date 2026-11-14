import { describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { routes } from '../router';
import { Blank } from '../test/mountView';
import { mockNative } from '../test/native';
import { installAppLinks } from './appLinks';

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })) },
}));

async function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((r) => ({ ...r, component: Blank })),
  });
  await router.push('/');
  mockNative();
  installAppLinks(router);
  const listener = vi.mocked(App.addListener).mock.calls[0][1] as unknown as (e: URLOpenListenerEvent) => void;
  return {
    router,
    open: async (url: string) => {
      listener({ url });
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe('installAppLinks', () => {
  it('does nothing on the website', () => {
    installAppLinks(createRouter({ history: createMemoryHistory(), routes }));
    expect(App.addListener).not.toHaveBeenCalled();
  });

  it('opens the share view for a share link', async () => {
    const { router, open } = await setup();
    await open('https://cardipaw.com/share/#d=abc');
    expect(router.currentRoute.value.name).toBe('share');
    expect(router.currentRoute.value.query.d).toBe('abc');
  });

  it('replaces the payload when a second link arrives on the share view', async () => {
    const { router, open } = await setup();
    await open('https://cardipaw.com/share/#d=one');
    await open('https://cardipaw.com/share/#d=two');
    expect(router.currentRoute.value.query.d).toBe('two');
  });

  it.each([
    'https://cardipaw.com/',
    'https://example.com/share/#d=x',
    'https://cardipaw.com/#/settings',
  ])('ignores %s', async (url) => {
    const { router, open } = await setup();
    await open(url);
    expect(router.currentRoute.value.name).toBe('home');
  });
});
