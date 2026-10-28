import type { Pet, Reading, Note, ExportPayload } from '../types';
import * as db from './db';
import { localDayKey } from '../utils/date';
import { isMeasurementSeconds } from '../utils/measurement';
import { usePetsStore } from '../stores/pets';
import { resetPetData } from '../stores/petData';

export type BackupErrorCode = 'unreadable' | 'invalid';

/** Thrown when a backup file cannot be parsed or is structurally not a CardiPaw backup. */
export class BackupError extends Error {
  constructor(public readonly code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface ValidatedBackup {
  data: ExportPayload;
  /** Records left out because they were damaged, duplicated or belonged to a skipped pet. */
  skipped: number;
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

// The rule: a user's own export must always restore. A record is only skipped
// when it cannot be shown at all (no id, no pet, no date, no rate, no content);
// a bad optional field is repaired or dropped instead.
// Converters build fresh objects with only the known fields, so unknown keys are
// dropped and the result is a plain (non-reactive) object IndexedDB can clone.

function toPet(value: unknown): Pet | null {
  if (!isObject(value)) return null;
  const { id, name, species, photo, birthdate, createdAt, normalCeiling, elevatedCeiling } = value;
  if (!isNonEmptyString(id) || typeof name !== 'string') return null;
  if (species !== 'cat' && species !== 'dog') return null;
  const pet: Pet = {
    id,
    name,
    species,
    // Anything but a PNG/JPEG base64 data URL (e.g. "data:," from a zero-size
    // canvas) is dropped rather than stored.
    photo: typeof photo === 'string' && PHOTO_DATA_URL.test(photo) ? photo : null,
    // Older versions allowed years like "20245"; an empty birthdate shows no age
    // and the edit form asks for a new one.
    birthdate: isDay(birthdate) ? birthdate : '',
    createdAt: isTimestamp(createdAt) ? toUtc(createdAt) : new Date().toISOString(),
  };
  // Ceilings are only type-checked: the pet form bounds new values only, and a user's own export must always restore.
  if (isFiniteNumber(normalCeiling)) pet.normalCeiling = normalCeiling;
  if (isFiniteNumber(elevatedCeiling)) pet.elevatedCeiling = elevatedCeiling;
  return pet;
}

function toReading(value: unknown): Reading | null {
  if (!isObject(value)) return null;
  const { id, petId, date, rate, clickCount, restState, notes, source, durationSeconds } = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(petId)) return null;
  // No usable rate (e.g. "" saved by an older edit form): the reading cannot be
  // shown or charted, and edited rates cannot be rebuilt from clickCount.
  if (!isTimestamp(date) || !isFiniteNumber(rate)) return null;
  const reading: Reading = {
    id,
    petId,
    date: toUtc(date),
    rate,
    clickCount: isFiniteNumber(clickCount) ? clickCount : 0,
  };
  if (restState === 'resting' || restState === 'sleeping') reading.restState = restState;
  if (typeof notes === 'string') reading.notes = notes;
  if (source === 'manual') reading.source = source;
  // Only a length the tracker offers, and only on a guided reading; anything else is
  // dropped (the label falls back to 30 s) rather than skipping the reading.
  else if (isMeasurementSeconds(durationSeconds)) reading.durationSeconds = durationSeconds;
  return reading;
}

function toNote(value: unknown): Note | null {
  if (!isObject(value)) return null;
  const { id, petId, title, content, createdAt, modifiedAt, pinnedAt } = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(petId)) return null;
  if (typeof content !== 'string' || !isTimestamp(createdAt)) return null;
  const note: Note = {
    id,
    petId,
    title: typeof title === 'string' ? title : '',
    content,
    createdAt: toUtc(createdAt),
  };
  if (isTimestamp(modifiedAt)) note.modifiedAt = toUtc(modifiedAt);
  if (isTimestamp(pinnedAt)) note.pinnedAt = toUtc(pinnedAt);
  return note;
}

/** Converts every item, keeping the first record per id; returns the kept records and how many were skipped. */
function convertAll<T extends { id: string }>(
  list: unknown[],
  convert: (v: unknown) => T | null,
  keep: (record: T) => boolean = () => true,
): { records: T[]; skipped: number } {
  const seen = new Set<string>();
  const records: T[] = [];
  for (const item of list) {
    const record = convert(item);
    if (!record || seen.has(record.id) || !keep(record)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return { records, skipped: list.length - records.length };
}

/**
 * Validates an untrusted value as a CardiPaw backup and returns a sanitized copy.
 * Only structural problems throw BackupError('invalid'): not an object, wrong
 * version, `pets`/`readings` (or a present `notes`) not arrays, or no usable pet
 * in a backup that has records. Damaged, duplicate and orphaned records are
 * skipped and counted; damaged optional fields are repaired.
 * `notes` may be absent (backups made before notes existed).
 */
export function validateBackup(value: unknown): ValidatedBackup {
  if (!isObject(value) || value.version !== 1) throw new BackupError('invalid', 'Not a CardiPaw backup');
  const { pets, readings, notes = [] } = value;
  if (!Array.isArray(pets) || !Array.isArray(readings)) throw new BackupError('invalid', 'Missing pets or readings');
  if (!Array.isArray(notes)) throw new BackupError('invalid', 'Invalid notes');

  const petResult = convertAll(pets, toPet);
  const hasRecords = pets.length + readings.length + notes.length > 0;
  if (hasRecords && petResult.records.length === 0) throw new BackupError('invalid', 'No valid pets in backup');

  // Records whose pet is not in the backup (or was skipped) can never be shown.
  const petIds = new Set(petResult.records.map((p) => p.id));
  const belongsToPet = (record: { petId: string }) => petIds.has(record.petId);
  const readingResult = convertAll(readings, toReading, belongsToPet);
  const noteResult = convertAll(notes, toNote, belongsToPet);

  return {
    data: {
      version: 1,
      exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
      pets: petResult.records,
      readings: readingResult.records,
      notes: noteResult.records,
    },
    skipped: petResult.skipped + readingResult.skipped + noteResult.skipped,
  };
}

/** Parses the text of a backup file. Throws BackupError on unreadable JSON or a structurally invalid backup. */
export function parseBackup(text: string): ValidatedBackup {
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
  a.download = `cardipaw-export-${localDayKey(new Date())}.json`;
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
  const { data } = validateBackup(payload);
  await db.importAllData(data);
  resetPetData(data.pets.map((p) => p.id));
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
