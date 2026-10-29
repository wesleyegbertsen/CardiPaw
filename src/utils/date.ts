// Calendar keys in the user's local timezone.
//
// Readings are stored as UTC ISO strings, so slicing them (`date.slice(0, 10)`)
// yields the UTC day, which can differ from the local day the user sees in
// labels and chart windows. Use these helpers for any day/month grouping or
// "today" comparison instead.

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** Local calendar day as "YYYY-MM-DD". */
export function localDayKey(value: string | Date): string {
  const d = toDate(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local calendar month as "YYYY-MM". */
export function localMonthKey(value: string | Date): string {
  const d = toDate(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * Moves a "YYYY-MM-DD" day key by `days` calendar days (negative = earlier).
 * Pure calendar arithmetic in UTC, so DST changes and the process timezone don't matter.
 */
export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
