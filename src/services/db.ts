import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { Pet, Reading, Note, ExportPayload } from '../types';

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
  notes: {
    key: string;
    value: Note;
    indexes: { 'by-petId': string };
  };
}

const DB_NAME = 'cardipaw';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<CardiPawDB>> | null = null;

function getDb(): Promise<IDBPDatabase<CardiPawDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CardiPawDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const petStore = db.createObjectStore('pets', { keyPath: 'id' });
          petStore.createIndex('by-name', 'name');

          const readingStore = db.createObjectStore('readings', { keyPath: 'id' });
          readingStore.createIndex('by-petId', 'petId');
          readingStore.createIndex('by-date', 'date');
        }
        if (oldVersion < 2) {
          const noteStore = db.createObjectStore('notes', { keyPath: 'id' });
          noteStore.createIndex('by-petId', 'petId');
        }
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

export async function deleteReading(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('readings', id);
}

export async function getNotesForPet(petId: string): Promise<Note[]> {
  const db = await getDb();
  return db.getAllFromIndex('notes', 'by-petId', petId);
}

export async function getAllNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.getAll('notes');
}

export async function saveNote(note: Note): Promise<void> {
  const db = await getDb();
  await db.put('notes', note);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('notes', id);
}

type PetDataTx = IDBPTransaction<CardiPawDB, ('pets' | 'readings' | 'notes')[], 'readwrite'>;

// Deletes one pet's records from a store inside the caller's transaction.
// Await only IDB requests here: awaiting anything else lets the transaction
// commit halfway. The deletes run one at a time, so when one throws no other
// request is left pending to reject unhandled after the abort.
async function deleteByPetId(tx: PetDataTx, storeName: 'readings' | 'notes', petId: string) {
  const store = tx.objectStore(storeName);
  const keys = await store.index('by-petId').getAllKeys(petId);
  for (const key of keys) await store.delete(key);
}

/** Deletes a pet with all its readings and notes, or nothing at all if any step fails. */
export async function deletePetCascade(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['pets', 'readings', 'notes'], 'readwrite');
  const done = tx.done;
  try {
    await tx.objectStore('pets').delete(id);
    await deleteByPetId(tx, 'readings', id);
    await deleteByPetId(tx, 'notes', id);
    await done;
  } catch (e) {
    // A delete() that throws synchronously does not abort the transaction, so
    // the deletes already made would commit. Abort to roll them back.
    try { tx.abort(); } catch { /* already aborted or finished */ }
    await done.catch(() => {});
    throw e;
  }
}

export async function exportAllData(): Promise<ExportPayload> {
  const [pets, readings, notes] = await Promise.all([getAllPets(), getAllReadings(), getAllNotes()]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    pets,
    readings,
    notes,
  };
}

export async function closeAndDeleteDatabase(): Promise<void> {
  if (!import.meta.env.DEV) throw new Error('closeAndDeleteDatabase is only available in dev mode');
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // proceed anyway; page reload cleans up
  });
}

export async function importAllData(payload: ExportPayload): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['pets', 'readings', 'notes'], 'readwrite');
  const done = tx.done;
  const requests: Promise<unknown>[] = [];
  try {
    // put() can throw synchronously (e.g. a DataError for a missing key), which
    // does not abort the transaction by itself, hence the explicit abort below.
    requests.push(tx.objectStore('pets').clear(), tx.objectStore('readings').clear(), tx.objectStore('notes').clear());
    for (const p of payload.pets) requests.push(tx.objectStore('pets').put(p));
    for (const r of payload.readings) requests.push(tx.objectStore('readings').put(r));
    for (const n of payload.notes) requests.push(tx.objectStore('notes').put(n));
    await Promise.all(requests);
    await done;
  } catch (e) {
    // Roll back the clears so existing data stays untouched. Requests already
    // queued now reject with AbortError; mark them handled.
    for (const request of requests) request.catch(() => {});
    try { tx.abort(); } catch { /* already aborted or finished */ }
    await done.catch(() => {});
    throw e;
  }
}
