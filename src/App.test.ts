// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import App from './App.vue';
import * as db from './services/db';
import { mountView, settle } from './test/mountView';

enableAutoUnmount(afterEach);

describe('App', () => {
  it('marks the current nav item active and hides the nav on shared pages', async () => {
    const { wrapper, router } = await mountView(App, '/');
    const items = wrapper.findAll('.bottom-nav .nav-item');
    expect(items).toHaveLength(2);
    expect(items[0].classes()).toContain('active');
    expect(items[1].classes()).not.toContain('active');

    await router.push('/settings');
    await settle();
    expect(wrapper.findAll('.bottom-nav .nav-item')[1].classes()).toContain('active');

    await router.push('/share');
    await settle();
    expect(wrapper.find('.bottom-nav').exists()).toBe(false);
    expect(wrapper.find('.app-main').classes()).toContain('no-nav');
  });

  it('logs a failed pet load instead of leaving the rejection unhandled', async () => {
    vi.spyOn(db, 'getAllPets').mockRejectedValue(new Error('idb broken'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await mountView(App, '/');
      await settle();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(error).toHaveBeenCalledWith('Loading pets failed', expect.any(Error));
    expect(unhandled).not.toHaveBeenCalled();
  });
});
