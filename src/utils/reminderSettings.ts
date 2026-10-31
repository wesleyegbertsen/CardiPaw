import { readStorage, writeStorage } from './storage';
import { MAX_SLOT, type ReminderSetting } from './reminderSchedule';

// Per pet, on this device only: not in IndexedDB, so an export or an import on another
// phone never carries reminders along.
const STORAGE_KEY = 'cardipaw-reminders';

export type ReminderDraft = Omit<ReminderSetting, 'slot'>;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const DEFAULT_REMINDER: ReminderDraft = { enabled: false, time: '22:00', days: ALL_DAYS };

/** "HH:mm", as <input type="time"> gives it. */
export function isValidTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function isValid(v: unknown): v is ReminderSetting {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.enabled === 'boolean' &&
    typeof s.time === 'string' &&
    isValidTime(s.time) &&
    Array.isArray(s.days) &&
    s.days.length > 0 &&
    new Set(s.days).size === s.days.length &&
    s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    Number.isInteger(s.slot) &&
    (s.slot as number) >= 1 &&
    (s.slot as number) <= MAX_SLOT
  );
}

/** Every valid stored setting by pet id. An invalid entry is dropped with a warning. */
export function loadReminderSettings(): Record<string, ReminderSetting> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readStorage(STORAGE_KEY) ?? '{}');
  } catch {
    console.warn('Ignoring unreadable reminder settings');
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, ReminderSetting> = {};
  const slots = new Set<number>();
  for (const [petId, v] of Object.entries(parsed)) {
    // Two pets on one slot would share notification ids: keep the first.
    if (!isValid(v) || slots.has(v.slot)) {
      console.warn('Ignoring an invalid reminder setting', petId, v);
      continue;
    }
    slots.add(v.slot);
    out[petId] = v;
  }
  return out;
}

function write(all: Record<string, ReminderSetting>): void {
  writeStorage(STORAGE_KEY, JSON.stringify(all));
}

/**
 * Stores a pet's setting, keeping its slot (else the smallest free one). Throws when it
 * wasn't stored (writeStorage only warns), so the dialog can say so.
 */
export function saveReminderSetting(petId: string, draft: ReminderDraft): ReminderSetting {
  const all = loadReminderSettings();
  let slot = all[petId]?.slot;
  if (!slot) {
    const used = new Set(Object.values(all).map((s) => s.slot));
    slot = 1;
    while (used.has(slot)) slot++;
  }
  const setting: ReminderSetting = {
    enabled: draft.enabled,
    time: draft.time,
    days: [...draft.days],
    slot,
  };
  all[petId] = setting;
  write(all);
  if (JSON.stringify(loadReminderSettings()[petId]) !== JSON.stringify(setting)) {
    throw new Error('Reminder setting was not stored');
  }
  return setting;
}

/** Drops a deleted pet's setting. Never throws. */
export function forgetReminderSetting(petId: string): void {
  const all = loadReminderSettings();
  if (!(petId in all)) return;
  delete all[petId];
  write(all);
}

/** Drops the settings of pets not in `keepPetIds`, e.g. after an import. Never throws. */
export function pruneReminderSettings(keepPetIds: Iterable<string>): void {
  const keep = new Set(keepPetIds);
  const all = loadReminderSettings();
  const ids = Object.keys(all).filter((id) => !keep.has(id));
  if (!ids.length) return;
  for (const id of ids) delete all[id];
  write(all);
}
