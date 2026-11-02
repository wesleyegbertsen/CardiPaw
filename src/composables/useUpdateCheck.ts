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
/**
 * Check now asks only once this long has passed since any check, so together with the daily
 * check the app never asks more than 60 times an hour, GitHub's limit without signing in.
 * Tapping every minute for an hour still reaches that limit.
 */
export const MIN_MANUAL_INTERVAL_MS = 60 * 1000;

interface UpdateState {
  /** When the last check started (ms since the epoch), successful or not. */
  lastCheck?: number;
  /** When the last successful check started; equal to lastCheck while that was the last check. */
  lastSuccess?: number;
  /** The newest release the last successful check found, as X.Y.Z. */
  latest?: string;
  /** The release whose notice the user closed, as X.Y.Z. */
  dismissed?: string;
}

/** What a check found, for Check now to show. */
export type CheckOutcome =
  { status: 'available'; version: Version } | { status: 'up-to-date' } | { status: 'failed' };

/** The saved state, keeping only fields that are valid: a damaged value must not break the app. */
function loadState(): UpdateState {
  try {
    const parsed: unknown = JSON.parse(readStorage(STATE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const { lastCheck, lastSuccess, latest, dismissed } = parsed as Record<string, unknown>;
    const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const isVersion = (v: unknown): v is string =>
      typeof v === 'string' && parseVersion(v) !== null;
    // Version 1.3.0 saved no lastSuccess, only latest after a successful check. Its lastCheck
    // dates the last attempt, which was most likely that success; if it failed instead, this
    // is a little too recent, until the next successful check saves the real time.
    const success = isTime(lastSuccess)
      ? lastSuccess
      : isTime(lastCheck) && isVersion(latest)
        ? lastCheck
        : undefined;
    return {
      ...(isTime(lastCheck) && { lastCheck }),
      ...(success !== undefined && { lastSuccess: success }),
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
let inFlight: Promise<CheckOutcome> | undefined;

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

/** When updates were last checked successfully (ms since the epoch); null if never. */
const lastChecked = computed(() => state.value.lastSuccess ?? null);

/** The installed release when checking is allowed: app only, setting on, release build. */
function checkableVersion(): Version | null {
  return isNative() && enabled.value ? releaseVersion(__APP_VERSION__) : null;
}

function outcomeOf(latest: Version, current: Version): CheckOutcome {
  return isNewer(latest, current)
    ? { status: 'available', version: latest }
    : { status: 'up-to-date' };
}

/** Saves the time before asking, so a failure (offline, rate limited) counts as a check too. */
function startCheck(now: number, current: Version): Promise<CheckOutcome> {
  save({ ...state.value, lastCheck: now });
  inFlight = fetchLatestRelease()
    .then((latest): CheckOutcome => {
      if (!latest) return { status: 'failed' };
      save({ ...state.value, latest: formatVersion(latest), lastSuccess: now });
      return outcomeOf(latest, current);
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

/**
 * App only, with the setting on, in a release build: asks GitHub about once a day. The time
 * is saved before asking, so a failure (offline, rate limited) also waits a day. Turning the
 * setting off doesn't stop a check already under way; it finishes harmlessly, since nothing
 * is shown while the setting is off.
 */
export async function checkIfDue(now = Date.now()): Promise<void> {
  const current = checkableVersion();
  if (!current) return;
  if (inFlight) {
    await inFlight;
    return;
  }
  const last = state.value.lastCheck;
  // A last check in the future means the clock was turned back: check now.
  if (last !== undefined && last <= now && now - last < CHECK_INTERVAL_MS) return;
  await startCheck(now, current);
}

/**
 * Check now: asks GitHub whatever the daily limit, and pushes the next daily check a day out.
 * A tap during a check gets that check's answer, and a tap within a minute of the last check
 * gets that check's answer again without asking. Null when checking isn't allowed.
 */
function checkNow(now = Date.now()): Promise<CheckOutcome | null> {
  const current = checkableVersion();
  if (!current) return Promise.resolve(null);
  if (inFlight) return inFlight;
  const { lastCheck, lastSuccess, latest } = state.value;
  if (lastCheck !== undefined && lastCheck <= now && now - lastCheck < MIN_MANUAL_INTERVAL_MS) {
    // Both are saved with the same time, so equal means the last check succeeded.
    const found = lastSuccess === lastCheck && latest ? parseVersion(latest) : null;
    return Promise.resolve(found ? outcomeOf(found, current) : { status: 'failed' });
  }
  return startCheck(now, current);
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

  return {
    enabled: readonly(enabled),
    available,
    showNotice,
    lastChecked,
    setEnabled,
    dismiss,
    checkNow,
  };
}
