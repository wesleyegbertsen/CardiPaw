import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportPayload, Note, Pet, Reading } from '../types';
import { failDeletesIn } from '../test/failDeletes';

type DbModule = typeof import('./db');

const pet = (id: string, name = id): Pet => ({
  id,
  name,
  species: 'dog',
  photo: null,
  birthdate: '2020-01-01',
  createdAt: '2024-01-01T00:00:00.000Z',
});

const reading = (id: string, petId: string, rate = 24): Reading => ({
  id,
  petId,
  date: '2026-03-15T12:00:00.000Z',
  rate,
  clickCount: rate / 2,
});

const note = (id: string, petId: string): Note => ({
  id,
  petId,
  title: `Note ${id}`,
  content: '<p>Hello</p>',
  createdAt: '2026-03-15T12:00:00.000Z',
});

const byId = <T extends { id: string }>(items: T[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

// db.ts caches its connection in module state, so every test gets a fresh
// in-memory IndexedDB and a fresh copy of the module.
async function freshDb(): Promise<DbModule> {
  vi.resetModules();
  return import('./db');
}

/** Creates the database as the v1 app (before notes existed) left it. */
function createV1Db(seed: { pets: Pet[]; readings: Reading[] }): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cardipaw', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const pets = db.createObjectStore('pets', { keyPath: 'id' });
      pets.createIndex('by-name', 'name');
      const readings = db.createObjectStore('readings', { keyPath: 'id' });
      readings.createIndex('by-petId', 'petId');
      readings.createIndex('by-date', 'date');
      seed.pets.forEach((p) => pets.put(p));
      seed.readings.forEach((r) => readings.put(r));
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

function storeLayout(): Promise<Record<string, string[]>> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cardipaw');
    req.onsuccess = () => {
      const db = req.result;
      const names = [...db.objectStoreNames].sort();
      const tx = db.transaction(names, 'readonly');
      const layout = Object.fromEntries(
        names.map((n) => [n, [...tx.objectStore(n).indexNames].sort()]),
      );
      db.close();
      resolve(layout);
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('database upgrades', () => {
  it('creates all stores and indexes on a fresh install', async () => {
    const db = await freshDb();
    expect(await db.getAllPets()).toEqual([]);
    expect(await db.getAllReadings()).toEqual([]);
    expect(await db.getAllNotes()).toEqual([]);

    // A second connection at the current version can open while db.ts holds its own.
    expect(await storeLayout()).toEqual({
      notes: ['by-petId'],
      pets: ['by-name'],
      readings: ['by-date', 'by-petId'],
    });
  });

  it('upgrades a v1 database to v2 and keeps existing pets and readings', async () => {
    const pets = [pet('a', 'Ace'), pet('b', 'Bo')];
    const readings = [reading('r1', 'a', 20), reading('r2', 'a', 30), reading('r3', 'b', 40)];
    await createV1Db({ pets, readings });

    const db = await freshDb();
    expect(byId(await db.getAllPets())).toEqual(pets);
    expect(byId(await db.getAllReadings())).toEqual(readings);
    expect(await db.getAllNotes()).toEqual([]);

    // The new notes store and the old indexes are usable straight away.
    await db.saveNote(note('n1', 'a'));
    expect(await db.getNotesForPet('a')).toEqual([note('n1', 'a')]);
    expect(byId(await db.getReadingsForPet('a'))).toEqual([readings[0], readings[1]]);
  });
});

describe('CRUD helpers', () => {
  let db: DbModule;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('saves, overwrites and deletes a pet', async () => {
    await db.savePet(pet('a', 'Ace'));
    await db.savePet({ ...pet('a', 'Ace'), name: 'Ace II' });
    expect(await db.getPet('a')).toMatchObject({ name: 'Ace II' });
    await db.deletePetCascade('a');
    expect(await db.getPet('a')).toBeUndefined();
  });

  describe('deletePetCascade', () => {
    beforeEach(async () => {
      await Promise.all([
        db.savePet(pet('a')),
        db.savePet(pet('b')),
        db.saveReading(reading('r1', 'a')),
        db.saveReading(reading('r2', 'a')),
        db.saveReading(reading('r3', 'b')),
        db.saveNote(note('n1', 'a')),
        db.saveNote(note('n2', 'a')),
        db.saveNote(note('n3', 'b')),
      ]);
    });

    it('deletes the pet with its readings and notes, and nothing else', async () => {
      await db.deletePetCascade('a');

      expect(await db.getAllPets()).toEqual([pet('b')]);
      expect(await db.getAllReadings()).toEqual([reading('r3', 'b')]);
      expect(await db.getAllNotes()).toEqual([note('n3', 'b')]);
    });

    it('resolves only after the transaction has committed', async () => {
      let committed = false;
      const transaction = IDBDatabase.prototype.transaction;
      vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
        this: IDBDatabase,
        ...args: Parameters<IDBDatabase['transaction']>
      ) {
        const tx = transaction.apply(this, args);
        tx.addEventListener('complete', () => (committed = true));
        return tx;
      });

      await db.deletePetCascade('a');

      expect(committed).toBe(true);
    });

    it('does nothing for an unknown pet', async () => {
      await db.deletePetCascade('missing');

      const data = await db.exportAllData();
      expect([data.pets.length, data.readings.length, data.notes.length]).toEqual([2, 3, 3]);
    });

    it('keeps the pet, its readings and its notes when a delete fails', async () => {
      // The pet, its readings and its first note are deleted before the delete
      // that fails. Deleting a store's records in parallel would leave a request
      // to reject unhandled.
      failDeletesIn('notes', { succeed: 1 });

      await expect(db.deletePetCascade('a')).rejects.toMatchObject({ name: 'UnknownError' });

      expect(await db.getPet('a')).toEqual(pet('a'));
      expect(byId(await db.getAllReadings())).toEqual([
        reading('r1', 'a'),
        reading('r2', 'a'),
        reading('r3', 'b'),
      ]);
      expect(byId(await db.getAllNotes())).toEqual([
        note('n1', 'a'),
        note('n2', 'a'),
        note('n3', 'b'),
      ]);
    });

    it('keeps everything when a delete request fails after it was made', async () => {
      // The request fails asynchronously, which aborts the transaction itself.
      failDeletesIn('notes', { succeed: 1, async: true });

      await expect(db.deletePetCascade('a')).rejects.toMatchObject({ name: 'ConstraintError' });

      expect(await db.getPet('a')).toEqual(pet('a'));
      expect(byId(await db.getAllReadings())).toEqual([
        reading('r1', 'a'),
        reading('r2', 'a'),
        reading('r3', 'b'),
      ]);
      expect(byId(await db.getAllNotes())).toEqual([
        note('n1', 'a'),
        note('n2', 'a'),
        note('n3', 'b'),
      ]);
    });
  });

  it('deletes only the targeted reading or note', async () => {
    await Promise.all([
      db.saveReading(reading('r1', 'a')),
      db.saveReading(reading('r2', 'a')),
      db.saveNote(note('n1', 'a')),
      db.saveNote(note('n2', 'a')),
    ]);

    await db.deleteReading('r1');
    await db.deleteNote('n2');

    expect(await db.getAllReadings()).toEqual([reading('r2', 'a')]);
    expect(await db.getAllNotes()).toEqual([note('n1', 'a')]);
  });

  it('returns each pet’s own readings and notes', async () => {
    await Promise.all([
      db.saveReading(reading('r1', 'a')),
      db.saveReading(reading('r2', 'b')),
      db.saveReading(reading('r3', 'a')),
      db.saveNote(note('n1', 'b')),
    ]);

    expect(byId(await db.getReadingsForPet('a'))).toEqual([reading('r1', 'a'), reading('r3', 'a')]);
    expect(await db.getReadingsForPet('b')).toEqual([reading('r2', 'b')]);
    expect(await db.getReadingsForPet('c')).toEqual([]);
    expect(await db.getNotesForPet('a')).toEqual([]);
    expect(await db.getNotesForPet('b')).toEqual([note('n1', 'b')]);
  });
});

describe('exportAllData / importAllData', () => {
  let db: DbModule;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('replaces all existing data with the imported backup', async () => {
    await db.savePet(pet('old'));
    await db.saveReading(reading('old-r', 'old'));
    await db.saveNote(note('old-n', 'old'));

    const payload: ExportPayload = {
      version: 1,
      exportedAt: '2026-03-20T10:00:00.000Z',
      pets: [pet('a', 'Ace'), pet('b', 'Bo')],
      readings: [reading('r1', 'a'), reading('r2', 'b', 32)],
      notes: [note('n1', 'a')],
    };
    await db.importAllData(payload);

    expect(byId(await db.getAllPets())).toEqual(payload.pets);
    expect(byId(await db.getAllReadings())).toEqual(payload.readings);
    expect(await db.getAllNotes()).toEqual(payload.notes);
    expect(await db.getPet('old')).toBeUndefined();
  });

  it('round-trips an export through import', async () => {
    await db.savePet(pet('a'));
    await db.saveReading(reading('r1', 'a'));
    await db.saveNote(note('n1', 'a'));

    const exported = await db.exportAllData();
    expect(exported).toMatchObject({ version: 1 });
    expect(Number.isNaN(Date.parse(exported.exportedAt))).toBe(false);

    // Import into a brand-new, empty database (as on another device).
    globalThis.indexedDB = new IDBFactory();
    const other = await freshDb();
    await other.importAllData(exported);

    expect(await other.getAllPets()).toEqual(exported.pets);
    expect(await other.getAllReadings()).toEqual(exported.readings);
    expect(await other.getAllNotes()).toEqual(exported.notes);
  });

  describe('rolls back and keeps existing data when a record cannot be stored', () => {
    const existing = async () => {
      await db.savePet(pet('old'));
      await db.saveReading(reading('old-r', 'old'));
      await db.saveNote(note('old-n', 'old'));
    };

    const expectExistingKept = async () => {
      expect(await db.getAllPets()).toEqual([pet('old')]);
      expect(await db.getAllReadings()).toEqual([reading('old-r', 'old')]);
      expect(await db.getAllNotes()).toEqual([note('old-n', 'old')]);
    };

    it('in the first store (a pet without an id)', async () => {
      await existing();
      const { id: _id, ...noId } = pet('a');
      await expect(
        db.importAllData({
          version: 1,
          exportedAt: '',
          pets: [noId as Pet],
          readings: [],
          notes: [],
        }),
      ).rejects.toThrow();
      await expectExistingKept();
    });

    it('in a later store (a reading without an id)', async () => {
      await existing();
      const { id: _id, ...noId } = reading('r1', 'a');
      await expect(
        db.importAllData({
          version: 1,
          exportedAt: '',
          pets: [pet('a')],
          readings: [reading('r0', 'a'), noId as Reading],
          notes: [note('n1', 'a')],
        }),
      ).rejects.toThrow();
      await expectExistingKept();
    });

    it('in the last store (a note without an id)', async () => {
      await existing();
      const { id: _id, ...noId } = note('n1', 'a');
      await expect(
        db.importAllData({
          version: 1,
          exportedAt: '',
          pets: [pet('a')],
          readings: [reading('r1', 'a')],
          notes: [noId as Note],
        }),
      ).rejects.toThrow();
      await expectExistingKept();
    });
  });
});

describe('closeAndDeleteDatabase', () => {
  it('refuses to run outside dev mode', async () => {
    vi.stubEnv('DEV', false);
    const db = await freshDb();
    await db.savePet(pet('a'));
    await expect(db.closeAndDeleteDatabase()).rejects.toThrow(/dev mode/);
    expect(await db.getAllPets()).toEqual([pet('a')]);
  });

  it('deletes everything in dev mode, and the next call reopens an empty database', async () => {
    vi.stubEnv('DEV', true);
    const db = await freshDb();
    await db.savePet(pet('a'));
    await db.saveReading(reading('r1', 'a'));

    await db.closeAndDeleteDatabase();

    expect(await db.getAllPets()).toEqual([]);
    expect(await db.getAllReadings()).toEqual([]);
    await db.savePet(pet('b'));
    expect(await db.getAllPets()).toEqual([pet('b')]);
  });
});
