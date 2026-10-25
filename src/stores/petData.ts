import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';

// Every per-pet cache is listed here, so deleting a pet or importing a backup
// cannot miss one when a new per-pet store is added.

/** Drops everything cached for one pet. Call it only after the pet is deleted. */
export function forgetPetData(petId: string): void {
  useReadingsStore().clearReadingsForPet(petId);
  useNotesStore().clearNotesForPet(petId);
}

/** Empties every per-pet cache, e.g. after a backup replaced all data. */
export function resetPetData(): void {
  useReadingsStore().$reset();
  useNotesStore().$reset();
}
