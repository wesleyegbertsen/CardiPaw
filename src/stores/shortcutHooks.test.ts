import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../services/db';
import { importBackup } from '../services/backup';
import { syncShortcuts } from '../native/shortcuts';
import { usePetsStore } from './pets';
import { makePet } from '../test/fixtures';
import type { Pet } from '../types';

vi.mock('../native/shortcuts', () => ({ syncShortcuts: vi.fn(async () => {}) }));

// The stores don't wait for the sync, so the read it starts is kept and awaited here.
let petsWhenSynced: Promise<Pet[]> | undefined;

beforeEach(async () => {
  localStorage.clear();
  await db.importAllData({
    version: 1,
    exportedAt: '',
    pets: [makePet(), makePet({ id: 'pet-2', name: 'Bo' })],
    readings: [],
    notes: [],
  });
  setActivePinia(createPinia());
  await usePetsStore().loadPets();
  petsWhenSynced = undefined;
  vi.mocked(syncShortcuts).mockClear();
  vi.mocked(syncShortcuts).mockImplementation(async () => {
    petsWhenSynced = db.getAllPets();
  });
});

describe('keeping launcher shortcuts in step', () => {
  it('syncs after a pet is added, once it is saved', async () => {
    await usePetsStore().addPet({
      name: 'Pip',
      species: 'cat',
      photo: null,
      birthdate: '2021-01-01',
    });
    expect(syncShortcuts).toHaveBeenCalledOnce();
    expect(await petsWhenSynced).toHaveLength(3);
  });

  it('syncs when a pet is renamed or its photo changes, not when only a ceiling changes', async () => {
    const pets = usePetsStore();
    await pets.updatePet('pet-1', { name: 'Max' });
    expect(syncShortcuts).toHaveBeenCalledOnce();
    expect((await petsWhenSynced)?.find((p) => p.id === 'pet-1')?.name).toBe('Max');

    vi.mocked(syncShortcuts).mockClear();
    await pets.updatePet('pet-1', { photo: 'data:image/png;base64,AA==' });
    expect(syncShortcuts).toHaveBeenCalledOnce();

    vi.mocked(syncShortcuts).mockClear();
    await pets.updatePet('pet-1', { normalCeiling: 40 });
    await pets.updatePet('pet-1', { name: 'Max', photo: 'data:image/png;base64,AA==' });
    expect(syncShortcuts).not.toHaveBeenCalled();
  });

  it('syncs after a pet is deleted, once it is gone from the database', async () => {
    await usePetsStore().removePet('pet-1');
    expect(syncShortcuts).toHaveBeenCalledOnce();
    expect((await petsWhenSynced)?.map((p) => p.id)).toEqual(['pet-2']);
  });

  it('syncs after a backup import, once the new pets are stored', async () => {
    await importBackup({
      version: 1,
      exportedAt: '',
      pets: [makePet({ id: 'pet-3', name: 'Pip' })],
      readings: [],
      notes: [],
    });
    expect(syncShortcuts).toHaveBeenCalledOnce();
    expect((await petsWhenSynced)?.map((p) => p.id)).toEqual(['pet-3']);
  });
});
