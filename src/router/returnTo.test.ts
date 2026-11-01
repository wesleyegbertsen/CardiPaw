import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import { routes } from './index';
import { returnTo } from './returnTo';

const Blank = defineComponent({ render: () => h('div') });
const make = (history = createWebHashHistory()) =>
  createRouter({ history, routes: routes.map((r) => ({ ...r, component: Blank })) });
// Real hash history: its state.back is what returnTo reads. happy-dom's history.back() fires
// no popstate, so the step back is checked on a router.back spy.
describe('returnTo', () => {
  it('steps back when the previous entry is the target', async () => {
    window.history.replaceState(null, '', '/#/');
    const router = make();
    await router.push('/');
    await router.isReady();
    await router.push({ name: 'pet', params: { id: 'p1' }, query: { tab: 'readings' } });
    await router.push({ name: 'reading', params: { id: 'p1', readingId: 'r1' } });
    const back = vi.spyOn(router, 'back').mockImplementation(() => {});
    const replace = vi.spyOn(router, 'replace');
    returnTo(router, { name: 'pet', params: { id: 'p1' }, query: { tab: 'readings' } });
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('steps back when the previous entry is the target with another tab open', async () => {
    window.history.replaceState(null, '', '/#/');
    const router = make();
    await router.push('/');
    await router.isReady();
    await router.push({ name: 'pet', params: { id: 'p1' }, query: { tab: 'notes' } });
    await router.push({ name: 'reading', params: { id: 'p1', readingId: 'r1' } });
    const back = vi.spyOn(router, 'back').mockImplementation(() => {});
    const replace = vi.spyOn(router, 'replace');
    returnTo(router, { name: 'pet', params: { id: 'p1' }, query: { tab: 'readings' } });
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('replaces on a cold start (deep link, no previous entry)', async () => {
    window.history.replaceState(null, '', '/#/pets/p1/readings/r1');
    const router = make();
    await router.push('/pets/p1/readings/r1');
    await router.isReady();
    expect(router.options.history.state.back).toBeNull();
    const len = window.history.length;
    returnTo(router, { name: 'pet', params: { id: 'p1' }, query: { tab: 'readings' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(router.currentRoute.value.fullPath).toBe('/pets/p1?tab=readings');
    expect(window.history.length).toBe(len);
  });

  it('replaces when arriving from a different screen', async () => {
    window.history.replaceState(null, '', '/#/');
    const router = make();
    await router.push('/');
    await router.isReady();
    await router.push('/settings');
    await router.push({ name: 'reading', params: { id: 'p1', readingId: 'r1' } });
    returnTo(router, { name: 'pet', params: { id: 'p1' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(router.currentRoute.value.path).toBe('/pets/p1');
  });
});
