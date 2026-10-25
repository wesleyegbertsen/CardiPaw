import { ref, watch } from 'vue';
import { readStorage, writeStorage } from '../utils/storage';

const STORAGE_KEY = 'cardipaw-tracker-prefs';

interface TrackerPrefs {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
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

  watch([soundEnabled, vibrationEnabled], () => {
    const all = loadAll();
    all[petId] = {
      soundEnabled: soundEnabled.value,
      vibrationEnabled: vibrationEnabled.value,
    };
    writeStorage(STORAGE_KEY, JSON.stringify(all));
  });

  return { soundEnabled, vibrationEnabled };
}
