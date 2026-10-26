import { vi } from 'vitest';
import { defineComponent, h, type Component } from 'vue';
import { flushPromises, mount, type Stubs } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type RouteLocationRaw } from 'vue-router';
import { routes } from '../router';
import * as db from '../services/db';
import { createTestI18n } from './i18n';
import { installIntersectionObserver } from './intersectionObserver';
import type { Note, Pet, Reading } from '../types';

/**
 * Helpers for mounting a whole view against the real stores, a real router and
 * fake-indexeddb (src/test/setup.ts). Runs in the dom vitest project.
 *
 * - Call `enableAutoUnmount(afterEach)` in the test file; mounted views attach to
 *   `document.body`.
 * - IndexedDB stays in memory for the whole file: seed only what a test needs and use
 *   unique ids, or clear the stores yourself.
 * - When faking time alongside IndexedDB, fake only the clock:
 *   `vi.useFakeTimers({ toFake: ['Date'] })`. Faking timers stalls fake-indexeddb.
 * - Teleported content (ConfirmDialog, modals) lives in `document.body`, not in the
 *   wrapper: query it with `document.body.querySelector`.
 */

/** Renders every route so the router never loads a real view chunk. */
export const Blank = defineComponent({ render: () => h('div') });

/** Lets IndexedDB callbacks, store promises and re-renders run to completion. */
export async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
  }
}

export interface SeedData {
  pets?: Pet[];
  readings?: Reading[];
  notes?: Note[];
}

/** Replaces everything in IndexedDB with the given records. */
export async function seed({ pets = [], readings = [], notes = [] }: SeedData = {}) {
  await db.importAllData({ version: 1, exportedAt: '', pets, readings, notes });
}

export interface MountViewOptions extends SeedData {
  stubs?: Stubs;
  props?: Record<string, unknown>;
}

/**
 * Seeds IndexedDB, then mounts `component` with a fresh pinia, test i18n and a memory
 * router already at `location`. `push` and `replace` are spies created before mounting,
 * so they also record navigation from `onMounted`.
 */
export async function mountView(
  component: Component,
  location: RouteLocationRaw,
  { stubs, props, ...data }: MountViewOptions = {},
) {
  await seed(data);
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((r) => ({ ...r, component: Blank })),
  });
  await router.push(location);
  await router.isReady();
  const push = vi.spyOn(router, 'push');
  const replace = vi.spyOn(router, 'replace');
  installIntersectionObserver();
  const wrapper = mount(component, {
    attachTo: document.body,
    props,
    global: { plugins: [pinia, router, createTestI18n()], stubs },
  });
  await settle();
  return { wrapper, router, pinia, push, replace };
}
