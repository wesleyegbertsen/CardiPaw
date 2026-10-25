import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';
import { forgetTrackerPrefs, pruneTrackerPrefs } from '../composables/useTrackerPrefs';

// Every per-pet cache and stored per-pet preference is handled here, so deleting
// a pet or importing a backup cannot miss one when a new one is added.

/** Drops everything kept for one pet outside IndexedDB. Call it only after the pet is deleted. */
export function forgetPetData(petId: string): void {
  useReadingsStore().clearReadingsForPet(petId);
  useNotesStore().clearNotesForPet(petId);
  forgetTrackerPrefs(petId);
}

/**
 * Empties every per-pet cache and drops the stored preferences of pets not in
 * `keepPetIds`, e.g. after a backup replaced all data.
 */
export function resetPetData(keepPetIds: string[]): void {
  useReadingsStore().$reset();
  useNotesStore().$reset();
  pruneTrackerPrefs(keepPetIds);
}
