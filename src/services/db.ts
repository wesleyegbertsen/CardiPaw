import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Pet, Reading, ExportPayload } from '../types';

interface CardiPawDB extends DBSchema {
  pets: {
    key: string;
    value: Pet;
    indexes: { 'by-name': string };
  };
  readings: {
    key: string;
    value: Reading;
    indexes: { 'by-petId': string; 'by-date': string };
  };
}

const DB_NAME = 'cardipaw';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CardiPawDB>> | null = null;

function getDb(): Promise<IDBPDatabase<CardiPawDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CardiPawDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const petStore = db.createObjectStore('pets', { keyPath: 'id' });
        petStore.createIndex('by-name', 'name');

        const readingStore = db.createObjectStore('readings', { keyPath: 'id' });
        readingStore.createIndex('by-petId', 'petId');
        readingStore.createIndex('by-date', 'date');
      },
    });
  }
  return dbPromise;
}

export async function getAllPets(): Promise<Pet[]> {
  const db = await getDb();
  return db.getAll('pets');
}

export async function getPet(id: string): Promise<Pet | undefined> {
  const db = await getDb();
  return db.get('pets', id);
}

export async function savePet(pet: Pet): Promise<void> {
  const db = await getDb();
  await db.put('pets', pet);
}

export async function deletePet(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('pets', id);
}

export async function getReadingsForPet(petId: string): Promise<Reading[]> {
  const db = await getDb();
  return db.getAllFromIndex('readings', 'by-petId', petId);
}

export async function getAllReadings(): Promise<Reading[]> {
  const db = await getDb();
  return db.getAll('readings');
}

export async function saveReading(reading: Reading): Promise<void> {
  const db = await getDb();
  await db.put('readings', reading);
}

export async function deleteReadingsForPet(petId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('readings', 'readwrite');
  const index = tx.store.index('by-petId');
  let cursor = await index.openCursor(IDBKeyRange.only(petId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function exportAllData(): Promise<ExportPayload> {
  const [pets, readings] = await Promise.all([getAllPets(), getAllReadings()]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    pets,
    readings,
  };
}

export async function importAllData(payload: ExportPayload): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['pets', 'readings'], 'readwrite');
  await tx.objectStore('pets').clear();
  await tx.objectStore('readings').clear();
  await Promise.all([
    ...payload.pets.map((p) => tx.objectStore('pets').put(p)),
    ...payload.readings.map((r) => tx.objectStore('readings').put(r)),
  ]);
  await tx.done;
}
