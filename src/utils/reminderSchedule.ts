import { localDayKey, shiftDayKey } from './date';

/** Days scheduled ahead, today included; the app tops them up whenever it opens. */
export const HORIZON_DAYS = 14;
const DAY_MS = 86_400_000;
// Epoch days stay below 100 000 until the year 2243.
const ID_DAYS = 100_000;
/** Highest slot whose ids still fit the plugin's 32-bit int ids: 21 000 * 100 000 + 99 999 < 2^31. */
export const MAX_SLOT = 21_000;

export interface ReminderSetting {
  enabled: boolean;
  /** Local time, "HH:mm". */
  time: string;
  /** Weekdays to remind on, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Per-pet number that keeps notification ids unique across pets (1 … MAX_SLOT). */
  slot: number;
}

export interface PlannedReminder {
  id: number;
  dayKey: string;
  at: Date;
}

function parts(dayKey: string): [number, number, number] {
  const [y, m, d] = dayKey.split('-').map(Number);
  return [y, m, d];
}

function epochDay(dayKey: string): number {
  const [y, m, d] = parts(dayKey);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Notification id for one pet's reminder on one day: stable, and unique across pets. */
export function reminderId(slot: number, dayKey: string): number {
  return slot * ID_DAYS + epochDay(dayKey);
}

/** The day a reminder id belongs to (getPending returns `at` as Java Date text, unusable). */
export function reminderDayKey(id: number): string {
  return new Date((id % ID_DAYS) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * One reminder per chosen weekday in the next HORIZON_DAYS days, starting today, except
 * days in `measuredDayKeys`. Today is included even when its time has passed: callers
 * schedule only `at > now`, but keep a due one that is still on its way (inexact alarms
 * can be minutes late).
 */
export function planReminders(
  setting: ReminderSetting,
  measuredDayKeys: ReadonlySet<string>,
  now: Date,
  horizonDays = HORIZON_DAYS,
): PlannedReminder[] {
  if (!setting.enabled) return [];
  const [hh, mm] = setting.time.split(':').map(Number);
  const today = localDayKey(now);
  const planned: PlannedReminder[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const dayKey = shiftDayKey(today, i);
    const [y, m, d] = parts(dayKey);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (!setting.days.includes(weekday) || measuredDayKeys.has(dayKey)) continue;
    // Local time; a time inside a DST gap moves forward (02:30 becomes 03:30).
    const at = new Date(y, m - 1, d, hh, mm);
    planned.push({ id: reminderId(setting.slot, dayKey), dayKey, at });
  }
  return planned;
}
