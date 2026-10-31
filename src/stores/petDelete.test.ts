import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../services/db';
import { usePetsStore } from './pets';
import { failDeletesIn } from '../test/failDeletes';
import { makePet } from '../test/fixtures';
import { mockNative } from '../test/native';
import { cleanUpExports } from '../services/nativeFile';

vi.mock('../services/nativeFile', () => ({ cleanUpExports: vi.fn(async () => {}) }));
// mockNative() would send syncReminders to the plugin; src/stores/reminderHooks.test.ts covers the calls.
vi.mock('../native/reminders', () => ({ syncReminders: vi.fn(async () => {}) }));

const STORAGE_KEY = 'cardipaw-tracker-prefs';
const prefs = { soundEnabled: false, vibrationEnabled: true };
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

beforeEach(async () => {
  await db.importAllData({
    version: 1,
    exportedAt: '',
    pets: [makePet(), makePet({ id: 'pet-2' })],
    readings: [],
    notes: [],
  });
  setActivePinia(createPinia());
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'pet-1': prefs, 'pet-2': prefs }));
  await usePetsStore().loadPets();
});

describe('deleting a pet', () => {
  it('forgets its tracker prefs', async () => {
    await usePetsStore().removePet('pet-1');
    expect(stored()).toEqual({ 'pet-2': prefs });
  });

  it('keeps its tracker prefs when the delete fails', async () => {
    failDeletesIn('pets');
    await expect(usePetsStore().removePet('pet-1')).rejects.toMatchObject({ name: 'UnknownError' });
    expect(stored()).toEqual({ 'pet-1': prefs, 'pet-2': prefs });
  });

  // Backups and PDFs aren't tagged per pet, and a backup holds every pet: delete them all.
  it('deletes the exported files in the app', async () => {
    mockNative();
    await usePetsStore().removePet('pet-1');
    expect(cleanUpExports).toHaveBeenCalledExactlyOnceWith();
  });

  it('leaves the file system alone on the website', async () => {
    await usePetsStore().removePet('pet-1');
    expect(cleanUpExports).not.toHaveBeenCalled();
  });

  it('keeps the exported files when the delete fails', async () => {
    mockNative();
    failDeletesIn('pets');
    await expect(usePetsStore().removePet('pet-1')).rejects.toMatchObject({ name: 'UnknownError' });
    expect(cleanUpExports).not.toHaveBeenCalled();
  });
});
