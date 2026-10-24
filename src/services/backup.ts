import type { Pet, Reading, Note, ExportPayload } from '../types';
import * as db from './db';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { useNotesStore } from '../stores/notes';

export type BackupErrorCode = 'unreadable' | 'invalid';

/** Thrown when a backup file cannot be parsed or does not pass validation. */
export class BackupError extends Error {
  constructor(public readonly code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

// Every timestamp the app writes comes from Date#toISOString(); also accept a
// numeric offset and missing seconds/milliseconds so hand-edited files still load.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Date.parse rolls impossible days over (2023-02-30 → March 2), so check that the
// calendar day survives a round trip.
function isCalendarDay(day: string): boolean {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value)
    && isCalendarDay(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
}

// The stores sort and slice timestamps as strings, so store them in the same
// canonical UTC form the app writes itself.
function toUtc(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && ISO_DAY.test(value) && isCalendarDay(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptional<T>(value: unknown, check: (v: unknown) => v is T): value is T | undefined {
  return value === undefined || check(value);
}

// Validators build fresh objects with only the known fields, so unknown keys are
// dropped and the result is a plain (non-reactive) object IndexedDB can clone.

function toPet(value: unknown): Pet | null {
  if (!isObject(value)) return null;
  const { id, name, species, photo, birthdate, createdAt, normalCeiling, elevatedCeiling } = value;
  if (!isNonEmptyString(id) || typeof name !== 'string') return null;
  if (species !== 'cat' && species !== 'dog') return null;
  if (photo !== null && photo !== undefined && !(typeof photo === 'string' && PHOTO_DATA_URL.test(photo))) return null;
  if (!isDay(birthdate) || !isTimestamp(createdAt)) return null;
  // Ceilings are only type-checked: the pet form itself allows any number here.
  if (!isOptional(normalCeiling, isFiniteNumber) || !isOptional(elevatedCeiling, isFiniteNumber)) return null;
  const pet: Pet = { id, name, species, photo: photo ?? null, birthdate, createdAt: toUtc(createdAt) };
  if (normalCeiling !== undefined) pet.normalCeiling = normalCeiling;
  if (elevatedCeiling !== undefined) pet.elevatedCeiling = elevatedCeiling;
  return pet;
}

function toReading(value: unknown): Reading | null {
  if (!isObject(value)) return null;
  const { id, petId, date, rate, clickCount, restState, notes, source } = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(petId)) return null;
  if (!isTimestamp(date) || !isFiniteNumber(rate)) return null;
  if (!isOptional(clickCount, isFiniteNumber)) return null;
  if (restState !== undefined && restState !== 'resting' && restState !== 'sleeping') return null;
  if (notes !== undefined && typeof notes !== 'string') return null;
  if (source !== undefined && source !== 'manual') return null;
  const reading: Reading = { id, petId, date: toUtc(date), rate, clickCount: clickCount ?? 0 };
  if (restState !== undefined) reading.restState = restState;
  if (notes !== undefined) reading.notes = notes;
  if (source !== undefined) reading.source = source;
  return reading;
}

function toNote(value: unknown): Note | null {
  if (!isObject(value)) return null;
  const { id, petId, title, content, createdAt, modifiedAt, pinnedAt } = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(petId)) return null;
  if (typeof title !== 'string' || typeof content !== 'string') return null;
  if (!isTimestamp(createdAt) || !isOptional(modifiedAt, isTimestamp) || !isOptional(pinnedAt, isTimestamp)) return null;
  const note: Note = { id, petId, title, content, createdAt: toUtc(createdAt) };
  if (modifiedAt !== undefined) note.modifiedAt = toUtc(modifiedAt);
  if (pinnedAt !== undefined) note.pinnedAt = toUtc(pinnedAt);
  return note;
}

function mapAll<T>(list: unknown[], convert: (v: unknown) => T | null, kind: string): T[] {
  return list.map((item, i) => {
    const result = convert(item);
    if (!result) throw new BackupError('invalid', `Invalid ${kind} at index ${i}`);
    return result;
  });
}

function assertUniqueIds(list: { id: string }[], kind: string): void {
  const seen = new Set<string>();
  for (const { id } of list) {
    if (seen.has(id)) throw new BackupError('invalid', `Duplicate ${kind} id "${id}"`);
    seen.add(id);
  }
}

/**
 * Validates an untrusted value as a CardiPaw backup and returns a sanitized copy.
 * Throws BackupError('invalid') if the payload or any record is malformed.
 * Readings and notes that reference a pet missing from the backup are dropped.
 * `notes` may be absent (backups made before notes existed).
 */
export function validateBackup(value: unknown): ExportPayload {
  if (!isObject(value) || value.version !== 1) throw new BackupError('invalid', 'Not a CardiPaw backup');
  const { pets, readings, notes } = value;
  if (!Array.isArray(pets) || !Array.isArray(readings)) throw new BackupError('invalid', 'Missing pets or readings');
  if (notes !== undefined && !Array.isArray(notes)) throw new BackupError('invalid', 'Invalid notes');

  const payload: ExportPayload = {
    version: 1,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    pets: mapAll(pets, toPet, 'pet'),
    readings: mapAll(readings, toReading, 'reading'),
    notes: mapAll(notes ?? [], toNote, 'note'),
  };
  assertUniqueIds(payload.pets, 'pet');
  assertUniqueIds(payload.readings, 'reading');
  assertUniqueIds(payload.notes, 'note');

  // Records whose pet is not in the backup can never be shown, so leave them out.
  const petIds = new Set(payload.pets.map((p) => p.id));
  payload.readings = payload.readings.filter((r) => petIds.has(r.petId));
  payload.notes = payload.notes.filter((n) => petIds.has(n.petId));
  return payload;
}

/** Parses the text of a backup file. Throws BackupError on unreadable JSON or invalid content. */
export function parseBackup(text: string): ExportPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('unreadable', 'The file is not valid JSON');
  }
  return validateBackup(parsed);
}

export function exportBackup(): Promise<ExportPayload> {
  return db.exportAllData();
}

/** Exports all data and triggers a JSON file download in the browser. */
export async function downloadBackup(): Promise<void> {
  const json = JSON.stringify(await exportBackup());
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `cardipaw-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Validates the payload, replaces all stored data with it in one transaction
 * (existing data is untouched if anything fails), then resets every store so
 * no pre-import data stays cached.
 */
export async function importBackup(payload: unknown): Promise<void> {
  const data = validateBackup(payload);
  await db.importAllData(data);
  useReadingsStore().$reset();
  useNotesStore().$reset();
  const petsStore = usePetsStore();
  petsStore.$reset();
  try {
    await petsStore.loadPets();
  } catch (e) {
    // The data is already imported, so this must not be reported as a failed
    // import. Reload the app so every view starts from the imported data.
    console.error('Reloading pets after import failed', e);
    window.location.reload();
  }
}
