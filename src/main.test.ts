import { afterEach, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { router } from './router';
import { installBackButton } from './native/backButton';
import { cleanUpOldExports } from './native/exportCleanup';
import { installReminders } from './native/reminders';
import { i18n } from './i18n';

vi.mock('./native/backButton', () => ({ installBackButton: vi.fn() }));
vi.mock('./native/exportCleanup', () => ({ cleanUpOldExports: vi.fn() }));
// syncReminders too: the stores import it.
vi.mock('./native/reminders', () => ({
  installReminders: vi.fn(),
  syncReminders: vi.fn(async () => {}),
}));

// main.ts mounts the app as an import side effect, which runs once per file:
// keep this file to a single test.
let app: App | undefined;
// Auto-unmount only tracks wrappers from mount(); main.ts uses createApp.
afterEach(() => app?.unmount());

it('mounts the app on #app with pinia, the router, i18n, the back button, export cleanup and reminders', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  await import('./main');

  app = (document.querySelector('#app') as Element & { __vue_app__?: App }).__vue_app__;
  expect(app).toBeDefined();
  const { $router, $pinia, $t } = app!.config.globalProperties;
  expect($router).toBe(router);
  expect($pinia).toBeDefined();
  expect($t('nav.settings')).toBe('Settings');
  expect(installBackButton).toHaveBeenCalledWith(router);
  expect(cleanUpOldExports).toHaveBeenCalledOnce();
  expect(installReminders).toHaveBeenCalledWith(router, i18n);

  // The home screen loads the (empty) pets store and renders in English.
  await vi.waitFor(() =>
    expect(document.querySelector('.empty-state h2')?.textContent).toBe('No pets yet'),
  );
  expect(router.currentRoute.value.name).toBe('home');
  expect(document.querySelector('.bottom-nav')?.textContent).toContain('Settings');
});
