import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../services/db';
import { cleanUpExports } from '../services/nativeFile';
import { forgetPetData, resetPetData } from './petData';
import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';
import { makeNote, makeReading } from '../test/fixtures';
import { mockNative } from '../test/native';
import { loadReminderSettings, saveReminderSetting } from '../utils/reminderSettings';

vi.mock('../services/nativeFile', () => ({ cleanUpExports: vi.fn(async () => {}) }));
// mockNative() would send syncReminders to the plugin; src/stores/reminderHooks.test.ts covers the calls.
vi.mock('../native/reminders', () => ({ syncReminders: vi.fn(async () => {}) }));

const PREFS_KEY = 'cardipaw-tracker-prefs';
const pet2Reading = makeReading({ id: 'r2', petId: 'pet-2' });
const pet2Note = makeNote({ id: 'n2', petId: 'pet-2' });

// Loads both pets' readings and notes into fresh stores.
beforeEach(async () => {
  localStorage.clear();
  await db.importAllData({
    version: 1,
    exportedAt: '',
    pets: [],
    readings: [makeReading(), pet2Reading],
    notes: [makeNote(), pet2Note],
  });
  setActivePinia(createPinia());
  for (const petId of ['pet-1', 'pet-2']) {
    await useReadingsStore().loadReadingsForPet(petId);
    await useNotesStore().loadNotesForPet(petId);
  }
});

describe('petData', () => {
  it('forgets only the given pet’s readings and notes', () => {
    forgetPetData('pet-1');

    expect(useReadingsStore().readingsByPet).toEqual({ 'pet-2': [pet2Reading] });
    expect(useNotesStore().notesByPet).toEqual({ 'pet-2': [pet2Note] });
  });

  it('resets every per-pet cache and keeps only the given pets’ prefs', () => {
    const prefs = { soundEnabled: false, vibrationEnabled: true };
    localStorage.setItem(PREFS_KEY, JSON.stringify({ 'pet-1': prefs, 'pet-2': prefs }));

    resetPetData(['pet-2']);

    expect(useReadingsStore().readingsByPet).toEqual({});
    expect(useNotesStore().notesByPet).toEqual({});
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')).toEqual({ 'pet-2': prefs });
  });

  it('drops a deleted pet’s reminder setting, and prunes them on reset', () => {
    const setting = { enabled: true, time: '22:00', days: [1] };
    for (const petId of ['pet-1', 'pet-2', 'pet-3']) saveReminderSetting(petId, setting);

    forgetPetData('pet-1');
    expect(Object.keys(loadReminderSettings())).toEqual(['pet-2', 'pet-3']);

    resetPetData(['pet-3']);
    expect(loadReminderSettings()).toEqual({ 'pet-3': { ...setting, slot: 3 } });
  });

  it('deletes every exported file on reset in the app', () => {
    mockNative();
    resetPetData([]);
    expect(cleanUpExports).toHaveBeenCalledExactlyOnceWith();
  });

  it('has no exported files to delete on reset on the website', () => {
    resetPetData([]);
    expect(cleanUpExports).not.toHaveBeenCalled();
  });
});
