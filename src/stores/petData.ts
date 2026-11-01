import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';
import { forgetTrackerPrefs, pruneTrackerPrefs } from '../composables/useTrackerPrefs';
import { cleanUpExports } from '../services/nativeFile';
import { isNative } from '../utils/platform';
import { forgetReminderSetting, pruneReminderSettings } from '../utils/reminderSettings';
import { syncReminders } from '../native/reminders';

// Every per-pet cache and stored per-pet preference is handled here, so deleting
// a pet or importing a backup cannot miss one when a new one is added.

/** Drops everything kept for one pet outside IndexedDB. Call it only after the pet is deleted. */
export function forgetPetData(petId: string): void {
  useReadingsStore().clearReadingsForPet(petId);
  useNotesStore().clearNotesForPet(petId);
  forgetTrackerPrefs(petId);
  forgetReminderSetting(petId);
  // Cancels the pet's reminders, found by the pet id they carry. Never rejects.
  void syncReminders(petId);
  // Exported backups and PDF reports in the app's cache hold the pet's data. They aren't
  // tagged per pet (and a backup holds every pet), so all of them go. Never rejects.
  if (isNative()) void cleanUpExports();
}

/**
 * Empties every per-pet cache and drops the stored preferences of pets not in
 * `keepPetIds`, e.g. after a backup replaced all data.
 */
export function resetPetData(keepPetIds: string[]): void {
  useReadingsStore().$reset();
  useNotesStore().$reset();
  pruneTrackerPrefs(keepPetIds);
  pruneReminderSettings(keepPetIds);
  // Every pet may have changed: cancels reminders of pets that are gone. Never rejects.
  void syncReminders();
  // The imported backup replaced every pet, while exports in the app's cache still hold the
  // previous data, so all of them go. Never rejects.
  if (isNative()) void cleanUpExports();
}
