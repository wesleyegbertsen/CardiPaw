import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import App from './App.vue';
import * as db from './services/db';
import { mountView, settle } from './test/mountView';
import { blockStorage } from './test/blockStorage';
import type { Version } from './utils/version';

// The update check's own logic is tested in useUpdateCheck.test.ts; here it only decides
// whether UpdateNotice has something to show.
const updates = vi.hoisted(() => ({
  available: undefined as unknown as { value: Version | null },
  showNotice: undefined as unknown as { value: boolean },
  dismiss: vi.fn(),
}));
vi.mock('./composables/useUpdateCheck', async () => {
  const { ref } = await import('vue');
  updates.available = ref(null);
  updates.showNotice = ref(false);
  return { useUpdateCheck: () => updates };
});

describe('App', () => {
  beforeEach(() => {
    updates.available.value = null;
    updates.showNotice.value = false;
  });

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

  it('shows the update notice, but not on shared pages', async () => {
    updates.available.value = [1, 3, 0];
    updates.showNotice.value = true;
    const { router } = await mountView(App, '/');
    expect(document.body.querySelector('.update-notice')).not.toBeNull();

    await router.push('/share');
    await settle();
    expect(document.body.querySelector('.update-notice')).toBeNull();
  });

  describe('route views', () => {
    // Numbers each instance, so a test can tell a fresh view from a reused one.
    let created = 0;
    const Probe = defineComponent({
      setup() {
        const id = ++created;
        return () => h('div', { class: 'probe' }, String(id));
      },
    });
    const mountProbe = (location: string) => mountView(App, location, { routeComponent: Probe });

    it('gives each pet its own view', async () => {
      const { wrapper, router } = await mountProbe('/pets/a');
      const first = wrapper.get('.probe').text();
      await router.push('/pets/b');
      await settle();
      expect(wrapper.get('.probe').text()).not.toBe(first);
    });

    it('starts a fresh form when going from adding a pet to editing one', async () => {
      const { wrapper, router } = await mountProbe('/pets/add');
      const first = wrapper.get('.probe').text();
      await router.push('/pets/x/edit');
      await settle();
      expect(wrapper.get('.probe').text()).not.toBe(first);
    });

    it('starts a fresh form when switching notes of the same pet', async () => {
      // Same pet id, different note id: keying by the pet alone would reuse the form.
      const { wrapper, router } = await mountProbe('/pets/a/notes/n1/edit');
      const first = wrapper.get('.probe').text();
      await router.push('/pets/a/notes/n2/edit');
      await settle();
      expect(wrapper.get('.probe').text()).not.toBe(first);
    });

    it('keeps the view when only the query changes, such as the pet tab', async () => {
      const { wrapper, router } = await mountProbe('/pets/a');
      const first = wrapper.get('.probe').text();
      await router.push({ path: '/pets/a', query: { tab: 'notes' } });
      await settle();
      expect(wrapper.get('.probe').text()).toBe(first);
    });
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

  it('still renders a shared snapshot when site data is blocked', async () => {
    blockStorage();
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    const { wrapper } = await mountView(App, '/share');
    expect(wrapper.find('.app-main').exists()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
