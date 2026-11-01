import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../services/db';
import { importBackup } from '../services/backup';
import { syncReminders } from '../native/reminders';
import { usePetsStore } from './pets';
import { useReadingsStore } from './readings';
import { makePet, makeReading } from '../test/fixtures';
import { loadReminderSettings, saveReminderSetting } from '../utils/reminderSettings';

vi.mock('../native/reminders', () => ({ syncReminders: vi.fn(async () => {}) }));

const setting = { enabled: true, time: '22:00', days: [1] };

beforeEach(async () => {
  localStorage.clear();
  await db.importAllData({
    version: 1,
    exportedAt: '',
    pets: [makePet(), makePet({ id: 'pet-2', name: 'Bo' })],
    readings: [makeReading()],
    notes: [],
  });
  setActivePinia(createPinia());
  await usePetsStore().loadPets();
  await useReadingsStore().loadReadingsForPet('pet-1');
  vi.mocked(syncReminders).mockClear();
});

describe('keeping reminders in step', () => {
  it('syncs the pet once a reading is added or deleted', async () => {
    const readings = useReadingsStore();
    const added = await readings.addReading({
      petId: 'pet-1',
      date: '2024-03-16T12:00:00.000Z',
      rate: 20,
      clickCount: 10,
    });
    expect(syncReminders).toHaveBeenCalledExactlyOnceWith('pet-1');

    vi.mocked(syncReminders).mockClear();
    await readings.removeReading(added.id, 'pet-1');
    expect(syncReminders).toHaveBeenCalledExactlyOnceWith('pet-1');
  });

  it('syncs the reading only after it is saved', async () => {
    // The store doesn't wait for the sync, so the read it starts is kept and awaited here.
    let saved: Promise<unknown[]> | undefined;
    vi.mocked(syncReminders).mockImplementation(async () => {
      saved = db.getReadingsForPet('pet-1');
    });
    await useReadingsStore().addReading({
      petId: 'pet-1',
      date: '2024-03-16T12:00:00.000Z',
      rate: 20,
      clickCount: 10,
    });
    expect(await saved).toHaveLength(2);
  });

  it('does not sync when a reading is edited', async () => {
    await useReadingsStore().updateReading(makeReading({ rate: 30 }));
    expect(syncReminders).not.toHaveBeenCalled();
  });

  it('syncs the pet when it is renamed, not when only its photo changes', async () => {
    const pets = usePetsStore();
    await pets.updatePet('pet-1', { photo: 'data:image/png;base64,AA==' });
    expect(syncReminders).not.toHaveBeenCalled();

    await pets.updatePet('pet-1', { name: 'Ace', photo: null });
    expect(syncReminders).not.toHaveBeenCalled();

    await pets.updatePet('pet-1', { name: 'Max' });
    expect(syncReminders).toHaveBeenCalledExactlyOnceWith('pet-1');
  });

  it('syncs a deleted pet after its reminder setting is gone', async () => {
    saveReminderSetting('pet-1', setting);
    let settingsWhenSynced: Record<string, unknown> = {};
    vi.mocked(syncReminders).mockImplementation(async () => {
      settingsWhenSynced = loadReminderSettings();
    });

    await usePetsStore().removePet('pet-1');

    expect(syncReminders).toHaveBeenCalledExactlyOnceWith('pet-1');
    expect(settingsWhenSynced).toEqual({});
  });

  it('syncs every pet after a backup import prunes the settings', async () => {
    saveReminderSetting('pet-1', setting);
    saveReminderSetting('pet-2', setting);
    let settingsWhenSynced: Record<string, unknown> = {};
    vi.mocked(syncReminders).mockImplementation(async () => {
      settingsWhenSynced = loadReminderSettings();
    });

    await importBackup({
      version: 1,
      exportedAt: '',
      pets: [makePet({ id: 'pet-2' })],
      readings: [],
      notes: [],
    });

    expect(syncReminders).toHaveBeenCalledExactlyOnceWith();
    expect(Object.keys(settingsWhenSynced)).toEqual(['pet-2']);
  });
});
