import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../services/db';
import { usePetsStore } from './pets';
import { failDeletesIn } from '../test/failDeletes';
import { makePet } from '../test/fixtures';

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
});
