import { App } from '@capacitor/app';
import { watch } from 'vue';
import type { Router } from 'vue-router';
import type { i18n as appI18n } from '../i18n';
import { openTracker } from '../router/openTracker';
import * as db from '../services/db';
import type { Pet } from '../types';
import { isNative } from '../utils/platform';
import { LauncherShortcuts, type ShortcutPet } from './launcherShortcuts';

type AppI18n = typeof appI18n;

/** Imported backups only regex-check photos (backup.ts): a bigger one gets the app icon. */
export const MAX_ICON_PHOTO_LENGTH = 512 * 1024;

// Set by installShortcuts. Only a type import of ../i18n above: loading it needs a DOM, and this
// module must also load without one (the Node test project, through the pets store).
let i18n: AppI18n | null = null;
// One sync at a time, like reminders.ts: an older sync must not publish a pet deleted since.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}
// The payload the plugin last accepted: an unchanged one isn't sent again.
let published: string | null = null;

function toShortcutPet(t: AppI18n['global']['t'], pet: Pet): ShortcutPet {
  // Android needs a non-empty label, and an imported pet may have no name.
  const name = pet.name.trim() || t('species.' + pet.species);
  const photo = pet.photo && pet.photo.length <= MAX_ICON_PHOTO_LENGTH ? pet.photo : null;
  return { id: pet.id, shortLabel: name, longLabel: t('shortcuts.longLabel', { name }), photo };
}

async function sync(): Promise<void> {
  if (!i18n) throw new Error('installShortcuts() must run before shortcuts are synced');
  const { t } = i18n.global;
  // From db, like reminders: the store is [] before it loads and during $reset, which would
  // disable every pin. db order is the home screen's order after a restart (#126, decision 2).
  const pets = await db.getAllPets();
  const payload = {
    pets: pets.map((p) => toShortcutPet(t, p)),
    disabledMessage: t('shortcuts.petDeleted'),
  };
  const key = JSON.stringify(payload);
  if (key === published) return;
  await LauncherShortcuts.setShortcuts(payload);
  // Only after success: a failed or rate-limited sync runs again on the next resume.
  published = key;
}

/** Brings the launcher shortcuts in line with the pets. Never rejects; does nothing on the website. */
export function syncShortcuts(): Promise<void> {
  if (!isNative()) return Promise.resolve();
  return enqueue(sync).catch((e) => console.error('Could not update launcher shortcuts', e));
}

export function installShortcuts(router: Router, appI18nInstance: AppI18n): void {
  if (!isNative()) return;
  i18n = appI18nInstance;
  void LauncherShortcuts.addListener('shortcutOpened', ({ petId }) => openTracker(router, petId));
  void App.addListener('resume', () => void syncShortcuts());
  watch(appI18nInstance.global.locale, () => void syncShortcuts());
  void syncShortcuts();
}
