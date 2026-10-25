import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupError, exportBackup, importBackup, parseBackup, validateBackup } from './backup';
import * as db from './db';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { useNotesStore } from '../stores/notes';
import { makeNote, makePet, makeReading } from '../test/fixtures';

const backup = (data: Record<string, unknown> = {}) => ({
  version: 1,
  exportedAt: '2024-03-20T10:00:00.000Z',
  pets: [makePet()],
  readings: [makeReading()],
  notes: [makeNote()],
  ...data,
});

const byId = <T extends { id: string }>(items: T[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

function expectInvalid(value: unknown) {
  expect(() => validateBackup(value)).toThrow(BackupError);
  try {
    validateBackup(value);
  } catch (e) {
    expect((e as BackupError).code).toBe('invalid');
  }
}

describe('validateBackup', () => {
  it('accepts a valid backup unchanged', () => {
    const value = backup();
    expect(validateBackup(value)).toEqual({ data: value, skipped: 0 });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'backup'],
    ['the wrong version', backup({ version: 2 })],
    ['missing pets', backup({ pets: undefined })],
    ['readings that are not an array', backup({ readings: {} })],
    ['notes that are not an array', backup({ notes: 'none' })],
    ['records without a single usable pet', backup({ pets: [{ id: 'x' }] })],
  ])('rejects %s', (_label, value) => {
    expectInvalid(value);
  });

  it('accepts an empty backup and one made before notes existed', () => {
    expect(validateBackup(backup({ pets: [], readings: [], notes: [] })).skipped).toBe(0);
    const { data } = validateBackup(backup({ notes: undefined }));
    expect(data.notes).toEqual([]);
  });

  it('repairs damaged optional pet fields', () => {
    const { data, skipped } = validateBackup(
      backup({
        pets: [
          makePet({
            photo: 'data:,',
            birthdate: '20245-01-01',
            normalCeiling: '30' as unknown as number,
            elevatedCeiling: 40,
          }),
        ],
      }),
    );
    expect(skipped).toBe(0);
    expect(data.pets[0]).toEqual(makePet({ photo: null, birthdate: '', elevatedCeiling: 40 }));
  });

  it('rejects impossible calendar days', () => {
    const { data } = validateBackup(backup({ pets: [makePet({ birthdate: '2023-02-30' })] }));
    expect(data.pets[0].birthdate).toBe('');
  });

  it('replaces an unusable pet createdAt with the current time', () => {
    // setSystemTime works without fake timers and leaves IndexedDB's timers alone.
    vi.setSystemTime(new Date('2024-05-01T08:00:00.000Z'));
    try {
      const { data } = validateBackup(backup({ pets: [makePet({ createdAt: 'yesterday' })] }));
      expect(data.pets[0].createdAt).toBe('2024-05-01T08:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes timestamps to canonical UTC', () => {
    const { data } = validateBackup(
      backup({
        readings: [makeReading({ date: '2024-03-15T14:00+02:00' })],
        notes: [makeNote({ createdAt: '2024-03-15T12:00:00Z', pinnedAt: 'soon' })],
      }),
    );
    expect(data.readings[0].date).toBe('2024-03-15T12:00:00.000Z');
    expect(data.notes[0].createdAt).toBe('2024-03-15T12:00:00.000Z');
    expect(data.notes[0]).not.toHaveProperty('pinnedAt');
  });

  it('skips unusable, duplicate and orphaned records and counts them', () => {
    const { data, skipped } = validateBackup(
      backup({
        pets: [
          makePet(),
          makePet({ name: 'Duplicate' }),
          makePet({ id: 'cat', species: 'fish' as 'cat' }),
        ],
        readings: [
          makeReading(),
          makeReading({ id: 'no-rate', rate: '' as unknown as number }),
          makeReading({ id: 'bad-date', date: '2024-13-01T00:00:00Z' }),
          makeReading({ id: 'orphan', petId: 'cat' }),
        ],
        notes: [makeNote(), makeNote(), makeNote({ id: 'no-content', content: undefined })],
      }),
    );
    expect(data.pets).toEqual([makePet()]);
    expect(data.readings).toEqual([makeReading()]);
    expect(data.notes).toEqual([makeNote()]);
    expect(skipped).toBe(2 + 3 + 2);
  });

  it('drops unknown keys and unknown enum values', () => {
    const { data } = validateBackup(
      backup({
        pets: [{ ...makePet(), extra: true }],
        readings: [{ ...makeReading(), restState: 'running', source: 'guided', __proto__x: 1 }],
      }),
    );
    expect(data.pets[0]).toEqual(makePet());
    expect(data.readings[0]).toEqual(makeReading());
  });
});

describe('parseBackup', () => {
  it('reports unreadable JSON separately from an invalid backup', () => {
    expect(() => parseBackup('{')).toThrow(expect.objectContaining({ code: 'unreadable' }));
    expect(() => parseBackup('{}')).toThrow(expect.objectContaining({ code: 'invalid' }));
  });
});

describe('export and import', () => {
  const emptyDb = () =>
    db.importAllData({ version: 1, exportedAt: '', pets: [], readings: [], notes: [] });

  beforeEach(async () => {
    setActivePinia(createPinia());
    await emptyDb();
  });

  afterEach(async () => {
    await emptyDb();
  });

  it('round-trips an export through JSON and import', async () => {
    await db.savePet(makePet());
    await db.saveReading(makeReading());
    await db.saveNote(makeNote({ pinnedAt: '2024-03-16T00:00:00.000Z' }));
    const exported = await exportBackup();

    await emptyDb();
    await importBackup(parseBackup(JSON.stringify(exported)).data);

    const again = await exportBackup();
    expect(again.pets).toEqual(exported.pets);
    expect(again.readings).toEqual(exported.readings);
    expect(again.notes).toEqual(exported.notes);
  });

  it('replaces existing data and resets every store', async () => {
    await db.savePet(makePet({ id: 'old' }));
    await db.saveReading(makeReading({ id: 'old-r', petId: 'old' }));
    const pets = usePetsStore();
    const readings = useReadingsStore();
    const notes = useNotesStore();
    await pets.loadPets();
    await readings.loadReadingsForPet('old');
    await notes.loadNotesForPet('old');

    const fresh = backup({ pets: [makePet({ id: 'new' })], readings: [], notes: [] });
    await importBackup(fresh);

    expect(pets.pets.map((p) => p.id)).toEqual(['new']);
    expect(readings.readingsByPet).toEqual({});
    expect(notes.notesByPet).toEqual({});
    expect(await db.getAllReadings()).toEqual([]);
    expect(await db.getPet('old')).toBeUndefined();
  });

  it('leaves the database and stores untouched when the payload is invalid', async () => {
    await db.savePet(makePet());
    const pets = usePetsStore();
    await pets.loadPets();

    await expect(importBackup({ version: 1, pets: 'x', readings: [] })).rejects.toThrow(
      BackupError,
    );

    expect(await db.getAllPets()).toEqual([makePet()]);
    expect(pets.pets).toEqual([makePet()]);
  });

  it('reloads the app when reloading pets fails after a successful import', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(usePetsStore(), 'loadPets').mockRejectedValue(new Error('boom'));

    await expect(importBackup(backup())).resolves.toBeUndefined();

    expect(reload).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();
    expect(byId(await db.getAllPets())).toEqual([makePet()]);
  });
});
