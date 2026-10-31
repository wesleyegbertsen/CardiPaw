import { computed, readonly, ref } from 'vue';
import { fetchLatestRelease } from '../services/githubRelease';
import { isNative } from '../utils/platform';
import { readStorage, writeStorage } from '../utils/storage';
import {
  formatVersion,
  isNewer,
  parseVersion,
  releaseVersion,
  type Version,
} from '../utils/version';

// Not part of the backup: these describe this installation, not the pets.
const ENABLED_KEY = 'cardipaw-update-check';
const STATE_KEY = 'cardipaw-update-state';
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface UpdateState {
  /** When the last check started (ms since the epoch), successful or not. */
  lastCheck?: number;
  /** The newest release the last successful check found, as X.Y.Z. */
  latest?: string;
  /** The release whose notice the user closed, as X.Y.Z. */
  dismissed?: string;
}

/** The saved state, keeping only fields that are valid: a damaged value must not break the app. */
function loadState(): UpdateState {
  try {
    const parsed: unknown = JSON.parse(readStorage(STATE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const { lastCheck, latest, dismissed } = parsed as Record<string, unknown>;
    const isVersion = (v: unknown): v is string =>
      typeof v === 'string' && parseVersion(v) !== null;
    return {
      ...(typeof lastCheck === 'number' && Number.isFinite(lastCheck) && { lastCheck }),
      ...(isVersion(latest) && { latest }),
      ...(isVersion(dismissed) && { dismissed }),
    };
  } catch {
    return {};
  }
}

// Off unless the user turned it on: missing, damaged or blocked storage all mean off.
const enabled = ref(readStorage(ENABLED_KEY) === '1');
const state = ref<UpdateState>(loadState());
let inFlight: Promise<void> | undefined;

function save(next: UpdateState) {
  state.value = next;
  writeStorage(STATE_KEY, JSON.stringify(next));
}

/** A release newer than this one, found by the opt-in check; null in a local build or on the website. */
const available = computed<Version | null>(() => {
  const current = releaseVersion(__APP_VERSION__);
  const latest = state.value.latest ? parseVersion(state.value.latest) : null;
  if (!isNative() || !enabled.value || !current || !latest) return null;
  return isNewer(latest, current) ? latest : null;
});

const showNotice = computed(
  () => available.value !== null && state.value.dismissed !== formatVersion(available.value),
);

/**
 * App only, with the setting on, in a release build: asks GitHub at most once a day. The time
 * is saved before asking, so a failure (offline, rate limited) also waits a day.
 */
export function checkIfDue(now = Date.now()): Promise<void> {
  if (!isNative() || !enabled.value || !releaseVersion(__APP_VERSION__)) return Promise.resolve();
  if (inFlight) return inFlight;
  const last = state.value.lastCheck;
  // A last check in the future means the clock was turned back: check now.
  if (last !== undefined && last <= now && now - last < CHECK_INTERVAL_MS) return Promise.resolve();
  save({ ...state.value, lastCheck: now });
  inFlight = fetchLatestRelease()
    .then((latest) => {
      if (latest) save({ ...state.value, latest: formatVersion(latest) });
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export function useUpdateCheck() {
  function setEnabled(on: boolean) {
    enabled.value = on;
    writeStorage(ENABLED_KEY, on ? '1' : '0');
    if (on) void checkIfDue();
  }

  function dismiss() {
    if (available.value) save({ ...state.value, dismissed: formatVersion(available.value) });
  }

  return { enabled: readonly(enabled), available, showNotice, setEnabled, dismiss };
}
