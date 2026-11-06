import type { Router } from 'vue-router';

/** A pet id from outside the app (a notification, a launcher shortcut): a non-empty string. */
export function isPetId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Opens the pet's tracker through the router, so the tracker's leave guards still ask before a
 * running count is dropped. Anything that isn't a pet id is ignored; an unknown id ends on home
 * (TrackerView's onMounted). No length cap: backup.ts accepts any non-empty id.
 */
export function openTracker(router: Router, petId: unknown): void {
  if (isPetId(petId)) void router.push({ name: 'tracker', params: { id: petId } });
}
