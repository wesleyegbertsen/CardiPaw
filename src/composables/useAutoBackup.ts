import { computed, readonly, ref } from 'vue';
import { exportBackup } from '../services/backup';
import {
  BackupFolder,
  errorCode,
  failureOf,
  type BackupFailure,
  type PickedFolder,
} from '../native/backupFolder';
import {
  backupFileName,
  DEFAULT_KEEP,
  filesToPrune,
  KEEP_CHOICES,
  type BackupFrequency,
} from '../utils/backupFiles';
import { isNative } from '../utils/platform';
import { readStorage, writeStorage } from '../utils/storage';

// Not part of the backup: these describe this installation, not the pets.
const CONFIG_KEY = 'cardipaw-auto-backup';
const STATE_KEY = 'cardipaw-auto-backup-state';
/** Changes within this long of each other are written once. */
export const DEBOUNCE_MS = 3000;

export interface BackupConfig {
  enabled: boolean;
  /** The picked folder's tree URI; Android holds CardiPaw's access to it. */
  folderUri?: string;
  folderName?: string;
  frequency: BackupFrequency;
  keep: number;
}

interface BackupState {
  /** When the last backup was written (ms since the epoch). */
  lastSuccess?: number;
  /** The file it was written to: a new period's name makes a backup due. */
  lastFile?: string;
  /** Why the last attempt failed; cleared by the next success. */
  failure?: BackupFailure;
  /** The failure whose notice the owner closed; a different one shows again. */
  dismissed?: BackupFailure;
  /** Data changed since the last backup; saved, so a restart still writes it. */
  dirty?: boolean;
}

/** What one run did, for Back up now to show. */
export type RunOutcome = 'saved' | 'nothing' | 'failed' | 'off';

const FAILURES: readonly unknown[] = [
  'revoked',
  'missing',
  'full',
  'failed',
] satisfies BackupFailure[];

function loadObject(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readStorage(key) ?? '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Only valid fields survive: a damaged value must not break the app, and means off. */
function loadConfig(): BackupConfig {
  const { enabled, folderUri, folderName, frequency, keep } = loadObject(CONFIG_KEY);
  const uri = typeof folderUri === 'string' && folderUri !== '' ? folderUri : undefined;
  return {
    enabled: enabled === true && uri !== undefined,
    ...(uri !== undefined && { folderUri: uri }),
    ...(typeof folderName === 'string' && { folderName }),
    frequency: frequency === 'weekly' ? 'weekly' : 'daily',
    keep: (KEEP_CHOICES as readonly unknown[]).includes(keep) ? (keep as number) : DEFAULT_KEEP,
  };
}

function loadState(): BackupState {
  const { lastSuccess, lastFile, failure, dismissed, dirty } = loadObject(STATE_KEY);
  const isFailure = (v: unknown): v is BackupFailure => FAILURES.includes(v);
  return {
    ...(typeof lastSuccess === 'number' && Number.isFinite(lastSuccess) && { lastSuccess }),
    ...(typeof lastFile === 'string' && { lastFile }),
    ...(isFailure(failure) && { failure }),
    ...(isFailure(dismissed) && { dismissed }),
    ...(dirty === true && { dirty }),
  };
}

const config = ref<BackupConfig>(loadConfig());
const state = ref<BackupState>(loadState());
const running = ref(false);
let inFlight: Promise<RunOutcome> | undefined;
let again = false;
/** Counts data changes, so a run can tell whether one came in while it was reading. */
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function saveConfig(next: BackupConfig) {
  config.value = next;
  writeStorage(CONFIG_KEY, JSON.stringify(next));
}

function save(next: BackupState) {
  state.value = next;
  writeStorage(STATE_KEY, JSON.stringify(next));
}

/** False once the owner turned backups off or picked another folder during a run. */
const stillFor = (uri: string) => config.value.enabled && config.value.folderUri === uri;

function fail(uri: string, kind: BackupFailure): RunOutcome {
  if (!stillFor(uri)) return 'off';
  const { dismissed, ...rest } = state.value;
  save({ ...rest, failure: kind, ...(dismissed === kind && { dismissed }) });
  return 'failed';
}

async function runOnce(): Promise<RunOutcome> {
  const { enabled, folderUri: uri, frequency, keep } = config.value;
  if (!isNative() || !enabled || !uri) return 'off';
  const seen = generation;
  let text: string;
  let pets: number;
  try {
    const payload = await exportBackup();
    pets = payload.pets.length;
    text = JSON.stringify(payload);
  } catch (e) {
    console.error('Automatic backup: reading the data failed', e);
    return fail(uri, 'failed');
  }
  // A fresh install or lost app data must never replace or prune the owner's good backups.
  if (pets === 0) {
    if (stillFor(uri)) save({ ...state.value, dirty: seen !== generation });
    return 'nothing';
  }
  const now = new Date();
  const name = backupFileName(now, frequency);
  try {
    await BackupFolder.writeFile({ uri, name, text });
  } catch (e) {
    // The code only: the plugin's messages never hold the folder's URI, and neither do logs.
    console.warn('Automatic backup failed', errorCode(e));
    return fail(uri, failureOf(e));
  }
  if (!stillFor(uri)) return 'off';
  save({ lastSuccess: now.getTime(), lastFile: name, dirty: seen !== generation });
  // Only after a successful write, and a failed prune doesn't fail the backup.
  try {
    const { names } = await BackupFolder.listFiles({ uri });
    for (const old of filesToPrune(names, keep, name))
      await BackupFolder.deleteFile({ uri, name: old });
  } catch (e) {
    console.warn('Pruning old backups failed', errorCode(e));
  }
  return 'saved';
}

/**
 * Runs a backup now. One run at a time: any number of requests during a run cause exactly one
 * more run afterwards (with the newest data), and every caller gets the last run's outcome.
 */
function backupSoon(): Promise<RunOutcome> {
  clearTimeout(timer);
  timer = undefined;
  if (inFlight) {
    again = true;
    return inFlight;
  }
  running.value = true;
  inFlight = (async () => {
    let outcome: RunOutcome;
    do {
      again = false;
      outcome = await runOnce();
    } while (again);
    return outcome;
  })().finally(() => {
    inFlight = undefined;
    running.value = false;
  });
  return inFlight;
}

/** db.onDataChanged: writes DEBOUNCE_MS after the last change; `dirty` covers a restart before that. */
export function noteDataChanged(): void {
  generation++;
  if (!config.value.enabled) return;
  if (!state.value.dirty) save({ ...state.value, dirty: true });
  clearTimeout(timer);
  timer = setTimeout(() => void backupSoon(), DEBOUNCE_MS);
}

/** At start and on resume: when data changed, the last attempt failed, or this period has no file yet. */
export async function backupIfDue(now = new Date()): Promise<void> {
  const { enabled, frequency } = config.value;
  if (!enabled) return;
  const { dirty, failure, lastFile } = state.value;
  if (dirty || failure || lastFile !== backupFileName(now, frequency)) await backupSoon();
}

/** On pause: writes a change still waiting for its debounce, best effort. */
export function flushPendingBackup(): void {
  if (timer !== undefined) void backupSoon();
}

/**
 * Checks the folder can still be used, so a deleted folder or lost access shows even on a day
 * with nothing to back up. Android still lists the grant after the folder is deleted.
 */
export async function probeFolder(): Promise<void> {
  const { enabled, folderUri: uri } = config.value;
  if (!isNative() || !enabled || !uri) return;
  try {
    await BackupFolder.checkFolder({ uri });
  } catch (e) {
    const kind = failureOf(e);
    if (kind === 'revoked' || kind === 'missing') fail(uri, kind);
    return;
  }
  // The folder is back (a re-inserted SD card, a restored folder): try again now.
  const { failure } = state.value;
  if (failure === 'revoked' || failure === 'missing') await backupSoon();
}

async function pick(): Promise<PickedFolder | 'cancelled' | 'unavailable'> {
  try {
    return await BackupFolder.pickFolder();
  } catch (e) {
    if (errorCode(e) === 'CANCELLED') return 'cancelled';
    console.warn('The folder picker failed', errorCode(e));
    return 'unavailable';
  }
}

function release(uri: string): Promise<void> {
  return BackupFolder.releaseFolder({ uri }).catch((e) =>
    console.warn('Releasing the backup folder failed', errorCode(e)),
  );
}

const showNotice = computed(() => {
  const { failure, dismissed } = state.value;
  return isNative() && config.value.enabled && failure !== undefined && dismissed !== failure;
});

export function useAutoBackup() {
  /** Asks for a folder; stays off when the picker is closed. */
  async function turnOn(): Promise<'on' | 'cancelled' | 'unavailable'> {
    const picked = await pick();
    if (typeof picked === 'string') return picked;
    saveConfig({ ...config.value, enabled: true, folderUri: picked.uri, folderName: picked.name });
    save({});
    void backupSoon();
    return 'on';
  }

  /** A cancelled picker keeps the old folder. */
  async function changeFolder(): Promise<'changed' | 'cancelled' | 'unavailable'> {
    const old = config.value.folderUri;
    const picked = await pick();
    if (typeof picked === 'string') return picked;
    saveConfig({ ...config.value, enabled: true, folderUri: picked.uri, folderName: picked.name });
    save({});
    // Picking the same folder again renews the grant just taken: releasing it would undo that.
    if (old && old !== picked.uri) void release(old);
    void backupSoon();
    return 'changed';
  }

  /** Keeps every file already written; only gives up access to the folder. */
  async function turnOff(): Promise<void> {
    const uri = config.value.folderUri;
    clearTimeout(timer);
    timer = undefined;
    saveConfig({ enabled: false, frequency: config.value.frequency, keep: config.value.keep });
    save({});
    if (uri) await release(uri);
  }

  function setFrequency(frequency: BackupFrequency) {
    saveConfig({ ...config.value, frequency });
    if (config.value.enabled) void backupSoon();
  }

  function setKeep(keep: number) {
    saveConfig({ ...config.value, keep });
  }

  function dismissNotice() {
    if (state.value.failure) save({ ...state.value, dismissed: state.value.failure });
  }

  return {
    config: readonly(config),
    lastSuccess: computed(() => state.value.lastSuccess ?? null),
    failure: computed(() => state.value.failure ?? null),
    showNotice,
    running: readonly(running),
    turnOn,
    changeFolder,
    turnOff,
    setFrequency,
    setKeep,
    backUpNow: backupSoon,
    dismissNotice,
  };
}
