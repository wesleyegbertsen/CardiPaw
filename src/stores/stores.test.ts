import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../services/db';
import { usePetsStore } from './pets';
import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';
import { makeNote, makePet, makeReading } from '../test/fixtures';
import type { Pet, Reading } from '../types';

// One db module instance for the whole file (the stores import it statically),
// so empty it before each test instead of swapping the IndexedDB factory.
beforeEach(async () => {
  await db.importAllData({ version: 1, exportedAt: '', pets: [], readings: [], notes: [] });
  setActivePinia(createPinia());
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('readings store', () => {
  it('lists a pet’s readings newest first', async () => {
    await db.saveReading(makeReading({ id: 'old', date: '2024-03-01T08:00:00.000Z' }));
    await db.saveReading(makeReading({ id: 'new', date: '2024-03-10T08:00:00.000Z' }));
    await db.saveReading(makeReading({ id: 'mid', date: '2024-03-05T08:00:00.000Z' }));
    await db.saveReading(makeReading({ id: 'other', petId: 'pet-2' }));
    const store = useReadingsStore();

    await store.loadReadingsForPet('pet-1');

    expect(store.getReadingsForPet('pet-1').map((r) => r.id)).toEqual(['new', 'mid', 'old']);
    expect(store.getReadingsForPet('pet-2')).toEqual([]);
  });

  it('adds, updates and removes readings in the store and the database', async () => {
    const store = useReadingsStore();
    const { id: _id, ...data } = makeReading();

    const added = await store.addReading(data);
    expect(added.id).toEqual(expect.any(String));
    expect(store.getReadingsForPet('pet-1')).toEqual([added]);

    const updated = { ...added, rate: 40 };
    await store.updateReading(updated);
    expect(store.getReadingsForPet('pet-1')).toEqual([updated]);
    expect(await db.getReadingsForPet('pet-1')).toEqual([updated]);

    await store.removeReading(added.id, 'pet-1');
    expect(store.getReadingsForPet('pet-1')).toEqual([]);
    expect(await db.getAllReadings()).toEqual([]);
  });

  it('ends up with fresh data when reset during a load', async () => {
    await db.saveReading(makeReading({ id: 'fresh' }));
    const held = deferred<Reading[]>();
    const spy = vi.spyOn(db, 'getReadingsForPet').mockImplementationOnce(() => held.promise);
    const store = useReadingsStore();

    const loading = store.loadReadingsForPet('pet-1');
    store.$reset();
    held.resolve([makeReading({ id: 'stale' })]);
    await loading;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(store.getReadingsForPet('pet-1').map((r) => r.id)).toEqual(['fresh']);
  });
});

describe('notes store', () => {
  it('lists pinned notes first, then by last change', async () => {
    await Promise.all([
      db.saveNote(makeNote({ id: 'old', createdAt: '2024-03-01T00:00:00.000Z' })),
      db.saveNote(
        makeNote({
          id: 'edited',
          createdAt: '2024-02-01T00:00:00.000Z',
          modifiedAt: '2024-03-05T00:00:00.000Z',
        }),
      ),
      db.saveNote(makeNote({ id: 'new', createdAt: '2024-03-03T00:00:00.000Z' })),
      db.saveNote(
        makeNote({
          id: 'pinned',
          createdAt: '2024-01-01T00:00:00.000Z',
          pinnedAt: '2024-01-02T00:00:00.000Z',
        }),
      ),
    ]);
    const store = useNotesStore();

    await store.loadNotesForPet('pet-1');

    expect(store.getNotesForPet('pet-1').map((n) => n.id)).toEqual([
      'pinned',
      'edited',
      'new',
      'old',
    ]);
  });

  it('adds, updates and removes notes', async () => {
    const store = useNotesStore();
    const { id: _id, ...data } = makeNote();
    const added = await store.addNote(data);
    await store.updateNote({ ...added, title: 'Changed' });
    expect(store.getNotesForPet('pet-1')[0].title).toBe('Changed');
    expect((await db.getNotesForPet('pet-1'))[0].title).toBe('Changed');

    await store.removeNote(added.id, 'pet-1');
    expect(store.getNotesForPet('pet-1')).toEqual([]);
    expect(await db.getAllNotes()).toEqual([]);
  });
});

describe('pets store', () => {
  it('ends up with fresh data when reset during a load', async () => {
    await db.savePet(makePet({ id: 'fresh' }));
    const held = deferred<Pet[]>();
    const spy = vi.spyOn(db, 'getAllPets').mockImplementationOnce(() => held.promise);
    const store = usePetsStore();

    const loading = store.loadPets();
    store.$reset();
    held.resolve([makePet({ id: 'stale' })]);
    await loading;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(store.pets.map((p) => p.id)).toEqual(['fresh']);
    expect(store.loading).toBe(false);
  });

  it('flags a failed load and clears the flag on a successful retry', async () => {
    vi.spyOn(db, 'getAllPets')
      .mockRejectedValueOnce(new Error('idb broken'))
      .mockResolvedValueOnce([makePet()]);
    const store = usePetsStore();

    await expect(store.loadPets()).rejects.toThrow('idb broken');
    expect(store.loadError).toBe(true);
    expect(store.loading).toBe(false);

    await store.loadPets();
    expect(store.loadError).toBe(false);
    expect(store.pets).toEqual([makePet()]);
  });

  it('does not flag a load that failed after a reset', async () => {
    let reject!: (e: Error) => void;
    const spy = vi
      .spyOn(db, 'getAllPets')
      .mockImplementationOnce(() => new Promise<Pet[]>((_, r) => (reject = r)));
    const store = usePetsStore();

    const loading = store.loadPets();
    store.$reset();
    reject(new Error('stale'));
    await loading;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(store.loadError).toBe(false);
  });

  it('adds a pet with a generated id and stores it', async () => {
    const store = usePetsStore();
    const { id: _id, createdAt: _createdAt, ...data } = makePet();

    const pet = await store.addPet(data);

    expect(pet.id).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(pet.createdAt))).toBe(false);
    expect(store.pets).toEqual([pet]);
    expect(await db.getAllPets()).toEqual([pet]);
  });

  it('updates a pet, and clears ceilings set to undefined', async () => {
    await db.savePet(makePet({ normalCeiling: 30, elevatedCeiling: 40 }));
    const store = usePetsStore();
    await store.loadPets();

    await store.updatePet('pet-1', {
      name: 'Renamed',
      normalCeiling: undefined,
      elevatedCeiling: undefined,
    });

    const [stored] = await db.getAllPets();
    expect(store.pets[0]).toEqual(stored);
    expect(stored.name).toBe('Renamed');
    expect(stored.normalCeiling).toBeUndefined();
    expect(stored.elevatedCeiling).toBeUndefined();
  });

  it('ignores updates for an unknown pet', async () => {
    const save = vi.spyOn(db, 'savePet');
    await usePetsStore().updatePet('missing', { name: 'x' });
    expect(save).not.toHaveBeenCalled();
  });

  it('removes a pet together with its readings and notes', async () => {
    await Promise.all([
      db.savePet(makePet()),
      db.savePet(makePet({ id: 'pet-2' })),
      db.saveReading(makeReading()),
      db.saveReading(makeReading({ id: 'r2', petId: 'pet-2' })),
      db.saveNote(makeNote()),
    ]);
    const pets = usePetsStore();
    const readings = useReadingsStore();
    const notes = useNotesStore();
    await pets.loadPets();
    await readings.loadReadingsForPet('pet-1');
    await notes.loadNotesForPet('pet-1');

    await pets.removePet('pet-1');

    expect(pets.pets.map((p) => p.id)).toEqual(['pet-2']);
    expect(readings.readingsByPet).not.toHaveProperty('pet-1');
    expect(notes.notesByPet).not.toHaveProperty('pet-1');
    expect(await db.getAllReadings()).toEqual([makeReading({ id: 'r2', petId: 'pet-2' })]);
    expect(await db.getAllNotes()).toEqual([]);
  });
});
