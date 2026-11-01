// Text for reminder settings: weekday names, the time, and the chosen days as a list.
// Takes the week start as a number: importing WEEK_START from ../i18n would load the
// whole i18n setup, which needs a DOM.

/** Weekdays (0 = Sunday) in the order a locale's week runs. */
export function orderedWeekdays(weekStart: 0 | 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/** 4 January 2026 is a Sunday; UTC so the device's zone can't shift the day. */
export function weekdayName(day: number, locale: string, width: 'short' | 'long'): string {
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 0, 4 + day)),
  );
}

/** "22:00" as the locale writes a time, e.g. "10:00 PM" in English. */
export function formatReminderTime(time: string, locale: string): string {
  const [hh, mm] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 4, hh, mm)));
}

/** The chosen days, in week order, e.g. "Mon, Wed, and Fri". */
export function formatDays(days: number[], locale: string, weekStart: 0 | 1): string {
  const names = orderedWeekdays(weekStart)
    .filter((d) => days.includes(d))
    .map((d) => weekdayName(d, locale, 'short'));
  // Japanese lists weekdays as 月・水・金; its list format would give 月、水、金.
  if (locale === 'ja') return names.join('・');
  return new Intl.ListFormat(locale, { type: 'conjunction', style: 'long' }).format(names);
}
