import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';
import { forgetTrackerPrefs } from '../composables/useTrackerPrefs';

// Every per-pet cache is listed here, so deleting a pet or importing a backup
// cannot miss one when a new per-pet store is added.

/** Drops everything kept for one pet outside IndexedDB. Call it only after the pet is deleted. */
export function forgetPetData(petId: string): void {
  useReadingsStore().clearReadingsForPet(petId);
  useNotesStore().clearNotesForPet(petId);
  forgetTrackerPrefs(petId);
}

/** Empties every per-pet cache, e.g. after a backup replaced all data. */
export function resetPetData(): void {
  useReadingsStore().$reset();
  useNotesStore().$reset();
}
