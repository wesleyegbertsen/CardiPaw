import { ref, watch } from 'vue';
import { readStorage, writeStorage } from '../utils/storage';
import {
  DEFAULT_MEASUREMENT_SECONDS,
  isMeasurementSeconds,
  type MeasurementSeconds,
} from '../utils/measurement';

const STORAGE_KEY = 'cardipaw-tracker-prefs';

interface TrackerPrefs {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  durationSeconds: MeasurementSeconds;
}

function loadAll(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readStorage(STORAGE_KEY) ?? '{}');
    // "null" would throw on lookup, and an array would silently drop every saved change.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function useTrackerPrefs(petId: string) {
  // Saved values are not trusted: a wrong type (e.g. the string "false", which is truthy)
  // falls back to the default instead of being used as is.
  const raw = loadAll()[petId];
  const saved =
    typeof raw === 'object' && raw !== null
      ? (raw as Partial<Record<keyof TrackerPrefs, unknown>>)
      : undefined;
  const soundEnabled = ref(typeof saved?.soundEnabled === 'boolean' ? saved.soundEnabled : true);
  const vibrationEnabled = ref(
    typeof saved?.vibrationEnabled === 'boolean' ? saved.vibrationEnabled : true,
  );
  const durationSeconds = ref<MeasurementSeconds>(
    isMeasurementSeconds(saved?.durationSeconds) ? saved.durationSeconds : DEFAULT_MEASUREMENT_SECONDS,
  );

  // Writes the whole object, so every pref must be both watched and written here.
  watch([soundEnabled, vibrationEnabled, durationSeconds], () => {
    const all = loadAll();
    all[petId] = {
      soundEnabled: soundEnabled.value,
      vibrationEnabled: vibrationEnabled.value,
      durationSeconds: durationSeconds.value,
    };
    writeStorage(STORAGE_KEY, JSON.stringify(all));
  });

  return { soundEnabled, vibrationEnabled, durationSeconds };
}

/** Removes a deleted pet's saved prefs. Never throws, even when storage is unavailable. */
export function forgetTrackerPrefs(petId: string): void {
  const all = loadAll();
  // Nothing saved: skip the write, which would only warn where storage is missing.
  if (!(petId in all)) return;
  delete all[petId];
  writeStorage(STORAGE_KEY, JSON.stringify(all));
}

/** Keeps only the listed pets' saved prefs, e.g. after a backup replaced all pets. Never throws. */
export function pruneTrackerPrefs(keepIds: Iterable<string>): void {
  const keep = new Set(keepIds);
  const all = loadAll();
  const kept = Object.fromEntries(Object.entries(all).filter(([id]) => keep.has(id)));
  // Nothing to drop: skip the write, which would only warn where storage is missing.
  if (Object.keys(kept).length === Object.keys(all).length) return;
  writeStorage(STORAGE_KEY, JSON.stringify(kept));
}
