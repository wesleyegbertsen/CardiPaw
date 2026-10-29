import { ref, watch } from 'vue';
import { readStorage, writeStorage } from '../utils/storage';
import { DEFAULT_MEASUREMENT_SECONDS, isMeasurementSeconds } from '../utils/measurement';
import type { MeasurementSeconds } from '../types';

const STORAGE_KEY = 'cardipaw-tracker-prefs';

interface TrackerPrefs {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  measurementSeconds: MeasurementSeconds;
}

function loadAll(): Record<string, TrackerPrefs> {
  try {
    const parsed: unknown = JSON.parse(readStorage(STORAGE_KEY) ?? '{}');
    // "null" would throw on lookup, and an array would silently drop every saved change.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, TrackerPrefs>)
      : {};
  } catch {
    return {};
  }
}

export function useTrackerPrefs(petId: string) {
  const saved = loadAll()[petId];
  const soundEnabled = ref(saved?.soundEnabled ?? true);
  const vibrationEnabled = ref(saved?.vibrationEnabled ?? true);
  // Prefs saved before the length could be chosen have none; a hand-edited or future value
  // the tracker doesn't offer falls back too.
  const savedSeconds: unknown = saved?.measurementSeconds;
  const measurementSeconds = ref<MeasurementSeconds>(
    isMeasurementSeconds(savedSeconds) ? savedSeconds : DEFAULT_MEASUREMENT_SECONDS,
  );

  // Writes the whole entry, so every pref must be listed here or changing another one drops it.
  watch([soundEnabled, vibrationEnabled, measurementSeconds], () => {
    const all = loadAll();
    all[petId] = {
      soundEnabled: soundEnabled.value,
      vibrationEnabled: vibrationEnabled.value,
      measurementSeconds: measurementSeconds.value,
    };
    writeStorage(STORAGE_KEY, JSON.stringify(all));
  });

  return { soundEnabled, vibrationEnabled, measurementSeconds };
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
