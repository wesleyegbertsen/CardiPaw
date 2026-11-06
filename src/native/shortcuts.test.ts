import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, type EffectScope } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { App } from '@capacitor/app';
import { routes } from '../router';
import { Blank } from '../test/mountView';
import { i18n, setLocale } from '../i18n';
import * as db from '../services/db';
import { makePet } from '../test/fixtures';
import { mockNative } from '../test/native';
import { deferred } from '../test/deferred';
import { LauncherShortcuts } from './launcherShortcuts';

vi.mock('./launcherShortcuts', () => ({
  LauncherShortcuts: {
    setShortcuts: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
  },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: async () => {} })) },
}));

const router = createRouter({
  history: createMemoryHistory(),
  routes: routes.map((r) => ({ ...r, component: Blank })),
});
const LS = vi.mocked(LauncherShortcuts);
const PHOTO = 'data:image/png;base64,AAAA';

// A fresh module per test: what it last published, and its queue, start empty.
let mod: typeof import('./shortcuts');
// installShortcuts watches the locale; each test's watcher stops with its scope.
let scope: EffectScope;
const install = () => scope.run(() => mod.installShortcuts(router, i18n));
const published = () => LS.setShortcuts.mock.calls.at(-1)![0];

beforeEach(async () => {
  vi.resetModules();
  mod = await import('./shortcuts');
  scope = effectScope();
  localStorage.clear();
  // Stored in id order: 'a' before 'b'.
  await db.importAllData({
    version: 1,
    exportedAt: '',
    pets: [makePet({ id: 'b', name: 'Mochi', photo: PHOTO }), makePet({ id: 'a', name: 'Bo' })],
    readings: [],
    notes: [],
  });
});

// A sync a test started and didn't await (installShortcuts starts one) would otherwise call
// the next test's mocks. Its own errors were the test's to check: drain them quietly.
afterEach(async () => {
  scope.stop();
  mockNative();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await mod.syncShortcuts();
});

describe('shortcuts', () => {
  it('does nothing on the website', async () => {
    mockNative(false);
    install();
    await mod.syncShortcuts();
    expect(LS.setShortcuts).not.toHaveBeenCalled();
    expect(LS.addListener).not.toHaveBeenCalled();
    expect(App.addListener).not.toHaveBeenCalled();
  });

  it("publishes every pet in stored order with labels in the app's language", async () => {
    mockNative();
    install();
    await mod.syncShortcuts();
    expect(LS.setShortcuts).toHaveBeenCalledExactlyOnceWith({
      pets: [
        { id: 'a', shortLabel: 'Bo', longLabel: 'Measure Bo', photo: null },
        { id: 'b', shortLabel: 'Mochi', longLabel: 'Measure Mochi', photo: PHOTO },
      ],
      disabledMessage: 'This pet was deleted',
    });
  });

  it('labels a pet without a name with its species', async () => {
    await db.savePet(makePet({ id: 'a', name: '  ', species: 'cat' }));
    mockNative();
    install();
    await mod.syncShortcuts();
    expect(published().pets[0]).toEqual({
      id: 'a',
      shortLabel: 'Cat',
      longLabel: 'Measure Cat',
      photo: null,
    });
  });

  it('sends no photo over the size limit, and keeps one at the limit', async () => {
    const photo = (length: number) => 'data:image/jpeg;base64,'.padEnd(length, 'A');
    const atLimit = photo(mod.MAX_ICON_PHOTO_LENGTH);
    await db.savePet(makePet({ id: 'a', name: 'Bo', photo: atLimit }));
    await db.savePet(
      makePet({ id: 'b', name: 'Mochi', photo: photo(mod.MAX_ICON_PHOTO_LENGTH + 1) }),
    );
    mockNative();
    install();
    await mod.syncShortcuts();
    expect(published().pets.map((p) => p.photo)).toEqual([atLimit, null]);
  });

  it("tells Android what a deleted pet's pin says, without any pet's name", async () => {
    mockNative();
    install();
    await mod.syncShortcuts();
    const { disabledMessage } = published();
    expect(disabledMessage).toBe('This pet was deleted');
    expect(disabledMessage).not.toMatch(/Mochi|Bo/);
  });

  it('relabels the shortcuts in the new language', async () => {
    mockNative();
    install();
    await mod.syncShortcuts();
    try {
      setLocale('nl');
      await nextTick();
      // The locale watcher's own sync, not one started here.
      await vi.waitFor(() => expect(LS.setShortcuts).toHaveBeenCalledTimes(2));
      expect(published().pets[1].longLabel).toBe('Mochi meten');
      expect(published().disabledMessage).toBe('Dit huisdier is verwijderd');
    } finally {
      // Later tests expect English; let the sync this starts finish here.
      setLocale('en');
      await nextTick();
      await mod.syncShortcuts();
    }
  });

  it('skips the plugin when nothing changed', async () => {
    mockNative();
    install();
    await mod.syncShortcuts();
    await mod.syncShortcuts();
    expect(LS.setShortcuts).toHaveBeenCalledOnce();
  });

  it('tries again on the next sync after the plugin failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    LS.setShortcuts.mockRejectedValueOnce(new Error('Rate-limited'));
    mockNative();
    install();
    await mod.syncShortcuts();
    await mod.syncShortcuts();
    expect(LS.setShortcuts).toHaveBeenCalledTimes(2);
    expect(LS.setShortcuts.mock.calls[1]).toEqual(LS.setShortcuts.mock.calls[0]);
  });

  it('logs and resolves when the plugin rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('Rate-limited');
    LS.setShortcuts.mockRejectedValueOnce(failure);
    mockNative();
    install();
    await expect(mod.syncShortcuts()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Could not update launcher shortcuts', failure);
  });

  it('logs instead of syncing before installShortcuts', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockNative();
    await expect(mod.syncShortcuts()).resolves.toBeUndefined();
    expect(LS.setShortcuts).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'Could not update launcher shortcuts',
      new Error('installShortcuts() must run before shortcuts are synced'),
    );
  });

  it('syncs again when the app comes back to the foreground', async () => {
    mockNative();
    install();
    await mod.syncShortcuts();
    // The mock's calls are typed by the first overload ('backButton').
    const [, onResume] = vi
      .mocked(App.addListener)
      .mock.calls.find(([event]) => (event as string) === 'resume')!;
    await db.savePet(makePet({ id: 'c', name: 'Pip' }));
    (onResume as () => void)();
    await mod.syncShortcuts();
    expect(LS.setShortcuts).toHaveBeenCalledTimes(2);
    expect(published().pets.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('runs one sync at a time: a pet deleted during a sync is gone in the next', async () => {
    mockNative();
    install();
    // The sync installShortcuts started, held inside the plugin call.
    const held = deferred<void>();
    LS.setShortcuts.mockReturnValueOnce(held.promise);
    await vi.waitFor(() => expect(LS.setShortcuts).toHaveBeenCalledOnce());
    await db.deletePetCascade('a');
    const second = mod.syncShortcuts();
    // Give a second sync that didn't wait time to read the pets and call the plugin.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(LS.setShortcuts).toHaveBeenCalledOnce();
    held.resolve();
    await second;
    expect(LS.setShortcuts).toHaveBeenCalledTimes(2);
    expect(published().pets.map((p) => p.id)).toEqual(['b']);
  });

  it("opens the pet's tracker when a shortcut is opened", async () => {
    mockNative();
    const push = vi.spyOn(router, 'push').mockResolvedValue(undefined);
    install();
    await mod.syncShortcuts();
    const [event, onOpen] = LS.addListener.mock.calls[0];
    expect(event).toBe('shortcutOpened');
    onOpen({ petId: 'b' });
    expect(push).toHaveBeenCalledExactlyOnceWith({ name: 'tracker', params: { id: 'b' } });
  });

  it('ignores a shortcut event with an empty pet id', async () => {
    mockNative();
    const push = vi.spyOn(router, 'push').mockResolvedValue(undefined);
    install();
    await mod.syncShortcuts();
    const [, onOpen] = LS.addListener.mock.calls[0];
    onOpen({ petId: '' });
    onOpen({});
    expect(push).not.toHaveBeenCalled();
  });
});
