// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { Ref } from 'vue';
import UpdateBanner from './UpdateBanner.vue';
import { createTestI18n } from '../test/i18n';

type RegisterOptions = { onRegistered?: (r: { update: () => void } | undefined) => void };

const sw = vi.hoisted(() => ({
  options: undefined as RegisterOptions | undefined,
  offlineReady: undefined as unknown as Ref<boolean>,
  needRefresh: undefined as unknown as Ref<boolean>,
  updateServiceWorker: vi.fn(),
}));

// Overrides the alias in vitest.config.ts so the test controls the refs.
vi.mock('virtual:pwa-register/vue', async () => {
  const { ref } = await import('vue');
  return {
    useRegisterSW: (options: RegisterOptions) => {
      sw.options = options;
      sw.offlineReady = ref(false);
      sw.needRefresh = ref(false);
      return sw;
    },
  };
});

enableAutoUnmount(afterEach);

const banner = () => document.body.querySelector<HTMLElement>('.update-banner');

function mountBanner() {
  return mount(UpdateBanner, {
    attachTo: document.body,
    global: { plugins: [createTestI18n()] },
  });
}

describe('UpdateBanner', () => {
  beforeEach(() => {
    sw.options = undefined;
    sw.updateServiceWorker.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('stays hidden until there is something to say', () => {
    mountBanner();
    expect(banner()).toBeNull();
  });

  it('offers a reload when a new version is waiting', async () => {
    mountBanner();
    sw.needRefresh.value = true;
    await flushPromises();
    expect(banner()!.getAttribute('role')).toBe('alert');
    expect(banner()!.querySelector('.update-message')!.textContent).toBe(
      'A new version is available.',
    );
    banner()!.querySelector<HTMLButtonElement>('.btn-reload')!.click();
    expect(sw.updateServiceWorker).toHaveBeenCalledOnce();
  });

  it('says the app works offline, without a reload button', async () => {
    mountBanner();
    sw.offlineReady.value = true;
    await flushPromises();
    expect(banner()!.querySelector('.update-message')!.textContent).toBe(
      'App ready to work offline.',
    );
    expect(banner()!.querySelector('.btn-reload')).toBeNull();
  });

  it('closes both messages', async () => {
    mountBanner();
    sw.offlineReady.value = true;
    sw.needRefresh.value = true;
    await flushPromises();
    banner()!.querySelector<HTMLButtonElement>('.btn-close')!.click();
    await flushPromises();
    expect(banner()).toBeNull();
    expect([sw.offlineReady.value, sw.needRefresh.value]).toEqual([false, false]);
  });

  it('checks for updates every hour once registered', () => {
    vi.useFakeTimers();
    mountBanner();
    const update = vi.fn();
    sw.options!.onRegistered!({ update });
    vi.advanceTimersByTime(60 * 60 * 1000 - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no registration is returned', () => {
    vi.useFakeTimers();
    mountBanner();
    sw.options!.onRegistered!(undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});
