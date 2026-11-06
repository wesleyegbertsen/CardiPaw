import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { App } from '@capacitor/app';
import { routes } from '../router';
import { Blank } from '../test/mountView';
import { i18n, setLocale } from '../i18n';
import * as db from '../services/db';
import { makePet, makeReading } from '../test/fixtures';
import { mockNative } from '../test/native';
import { deferred } from '../test/deferred';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import type { WidgetSnapshot } from '../utils/widgetSnapshot';

const { setSnapshot } = vi.hoisted(() => ({
  setSnapshot: vi.fn(async (_: { json: string }) => {}),
}));
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: vi.fn(() => ({ setSnapshot })),
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })) },
}));
// The stores call it; not under test here.
vi.mock('./reminders', () => ({ syncReminders: vi.fn(async () => {}) }));

const { installHomeWidget, syncHomeWidget } = await import('./homeWidget');

// Module-level, like the app's: install happens once per file and keeps this router.
const router = createRouter({
  history: createMemoryHistory(),
  routes: routes.map((r) => ({ ...r, component: Blank })),
});
const sent = (call = -1): WidgetSnapshot => JSON.parse(setSnapshot.mock.calls.at(call)![0].json);
/** The last snapshot sent, once it satisfies check. Never calls syncHomeWidget itself. */
const sentWhen = (check: (s: WidgetSnapshot) => void) => vi.waitFor(() => check(sent()));
const now = () => new Date().toISOString();

// The mock's calls are typed by the first overload ('backButton').
const handler = (event: string) =>
  vi.mocked(App.addListener).mock.calls.find(([e]) => (e as string) === event)![1] as unknown;
// Captured at install: restoreMocks clears the mock's calls after each test.
let onResume: () => void;
let openUrl: (data: { url: string }) => void;

let installed = false;
beforeEach(async () => {
  setActivePinia(createPinia());
  await db.importAllData({
    version: 1,
    exportedAt: '',
    pets: [makePet({ id: 'p1', name: 'Mochi' })],
    readings: [],
    notes: [],
  });
  await router.push('/');
  // Every test: restoreMocks undoes the spy, and syncHomeWidget checks isNative() on each call.
  mockNative();
  if (!installed) {
    // Once per file: install keeps its listeners for the module's lifetime, as in the app.
    effectScope().run(() => installHomeWidget(router, i18n));
    onResume = handler('resume') as () => void;
    openUrl = handler('appUrlOpen') as (data: { url: string }) => void;
    installed = true;
  }
  await syncHomeWidget();
  setSnapshot.mockClear();
});

describe('installHomeWidget', () => {
  it('installs nothing on the website', async () => {
    mockNative(false);
    vi.mocked(App.addListener).mockClear();
    effectScope().run(() => installHomeWidget(router, i18n));
    await db.saveReading(makeReading({ petId: 'p1', date: now() }));
    expect(App.addListener).not.toHaveBeenCalled();
    expect(setSnapshot).not.toHaveBeenCalled();
  });
});

describe('syncHomeWidget', () => {
  it('does nothing on the website', async () => {
    mockNative(false);
    await syncHomeWidget();
    expect(setSnapshot).not.toHaveBeenCalled();
  });

  it('sends what IndexedDB holds, in the app language', async () => {
    await db.saveReading(makeReading({ petId: 'p1', rate: 33, date: now() }));
    await sentWhen((s) =>
      expect(s.pets).toMatchObject([
        { id: 'p1', name: 'Mochi', latest: { rate: 33, status: 'warning' } },
      ]),
    );
    expect(sent().locale).toBe('en');
  });

  it("syncs after a reading is edited and after a pet's ceiling changes", async () => {
    const reading = makeReading({ petId: 'p1', rate: 24, date: now() });
    await db.saveReading(reading);
    await useReadingsStore().updateReading({ ...reading, rate: 40 });
    await sentWhen((s) => expect(s.pets[0].latest?.status).toBe('danger'));
    const pets = usePetsStore();
    await pets.loadPets();
    await pets.updatePet('p1', { normalCeiling: 45, elevatedCeiling: 50 });
    await sentWhen((s) => expect(s.pets[0].latest?.status).toBe('normal'));
  });

  it('syncs after an import replaced every pet', async () => {
    await db.importAllData({
      version: 1,
      exportedAt: '',
      pets: [makePet({ id: 'p2', name: 'Bo' })],
      readings: [],
      notes: [],
    });
    await sentWhen((s) => expect(s.pets.map((p) => p.id)).toEqual(['p2']));
  });

  it('syncs on resume', async () => {
    onResume();
    await vi.waitFor(() => expect(setSnapshot).toHaveBeenCalledOnce());
    expect(sent().pets.map((p) => p.id)).toEqual(['p1']);
  });

  it('syncs in the new language when it changes', async () => {
    try {
      setLocale('nl');
      await nextTick();
      await sentWhen((s) => expect(s.locale).toBe('nl'));
      expect(sent().strings.noPets).toBe(i18n.global.t('home.noPetsTitle'));
    } finally {
      setLocale('en');
    }
  });

  it('runs one build at a time and folds a burst into one more', async () => {
    const gate = deferred<void>();
    setSnapshot.mockImplementationOnce(() => gate.promise);
    const first = syncHomeWidget();
    await vi.waitFor(() => expect(setSnapshot).toHaveBeenCalledOnce());
    // Three writes while the first is still being sent.
    for (const id of ['a', 'b', 'c']) {
      await db.saveReading(makeReading({ id, petId: 'p1', date: now() }));
    }
    expect(setSnapshot).toHaveBeenCalledOnce();
    gate.resolve();
    await first;
    await vi.waitFor(() => expect(setSnapshot).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(setSnapshot).toHaveBeenCalledTimes(2);
  });

  it('builds after a write that lands while a build is running', async () => {
    const gate = deferred<void>();
    // The first build has read IndexedDB once it sends.
    setSnapshot.mockImplementationOnce(() => gate.promise);
    const first = syncHomeWidget();
    await vi.waitFor(() => expect(setSnapshot).toHaveBeenCalledOnce());
    expect(sent().pets[0].latest).toBeNull();

    await db.saveReading(makeReading({ petId: 'p1', rate: 40, date: now() }));
    gate.resolve();
    await first;

    await vi.waitFor(() => expect(setSnapshot).toHaveBeenCalledTimes(2));
    expect(sent().pets[0].latest).toMatchObject({ rate: 40, status: 'danger' });
  });

  it('never rejects, and logs a failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setSnapshot.mockRejectedValueOnce(new Error('boom'));
    await expect(syncHomeWidget()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      'Could not update the home screen widget',
      expect.any(Error),
    );
  });
});

describe('a widget tap', () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('opens the pet', async () => {
    openUrl({ url: 'cardipaw-widget://pet/p1' });
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/pets/p1'));
  });

  it('goes home for a pet that no longer exists', async () => {
    await router.push('/settings');
    openUrl({ url: 'cardipaw-widget://pet/gone' });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'));
  });

  it('goes home from the "+N more" row', async () => {
    await router.push('/settings');
    openUrl({ url: 'cardipaw-widget://home' });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('home'));
  });

  it("ignores a URL that isn't a widget's", async () => {
    await router.push('/settings');
    openUrl({ url: 'https://evil.example/pet/p1' });
    await settle();
    expect(router.currentRoute.value.name).toBe('settings');
  });

  it('waits for the router to be ready', async () => {
    // A cold start's tap arrives before the first navigation has finished.
    const ready = deferred<void>();
    vi.spyOn(router, 'isReady').mockReturnValueOnce(ready.promise);
    openUrl({ url: 'cardipaw-widget://pet/p1' });
    await settle();
    expect(router.currentRoute.value.name).toBe('home');

    ready.resolve();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/pets/p1'));
  });

  it("doesn't push the route it is already on", async () => {
    await router.push('/pets/p1');
    const push = vi.spyOn(router, 'push');
    openUrl({ url: 'cardipaw-widget://pet/p1' });
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it('logs a tap it could not open', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('boom');
    vi.spyOn(router, 'push').mockRejectedValueOnce(failure);
    openUrl({ url: 'cardipaw-widget://pet/p1' });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('Could not open the widget tap', failure),
    );
  });
});
