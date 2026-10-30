import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { App, type BackButtonListener } from '@capacitor/app';
import { routes } from '../router';
import { Blank } from '../test/mountView';
import { useModal } from '../composables/useModal';
import { mockNative } from '../test/native';
import { installBackButton } from './backButton';

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    minimizeApp: vi.fn(async () => {}),
  },
}));

const Dialog = (onClose: () => void) =>
  defineComponent({
    setup() {
      const dialogRef = ref<HTMLElement | null>(null);
      useModal(dialogRef, { onClose });
      return () => h('div', { ref: dialogRef, tabindex: -1 });
    },
  });

async function setup(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((r) => ({ ...r, component: Blank })),
  });
  await router.push(path);
  mockNative();
  installBackButton(router);
  const listener = vi.mocked(App.addListener).mock.calls[0][1] as BackButtonListener;
  const back = vi.spyOn(router, 'back').mockImplementation(() => {});
  const replace = vi.spyOn(router, 'replace');
  return { press: (canGoBack: boolean) => listener({ canGoBack }), back, replace };
}

describe('installBackButton', () => {
  it('does nothing on the website', () => {
    installBackButton(createRouter({ history: createMemoryHistory(), routes }));
    expect(App.addListener).not.toHaveBeenCalled();
  });

  it('closes an open dialog instead of navigating', async () => {
    const { press, back } = await setup('/settings');
    const onClose = vi.fn();
    mount(Dialog(onClose), { attachTo: document.body });
    press(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('goes back a screen', async () => {
    const { press, back } = await setup('/settings');
    press(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('goes home when there is no screen to go back to', async () => {
    const { press, back, replace } = await setup('/settings');
    press(false);
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith({ name: 'home' });
  });

  it('sends the app to the background from home', async () => {
    const { press, back } = await setup('/');
    press(true);
    expect(App.minimizeApp).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });
});
