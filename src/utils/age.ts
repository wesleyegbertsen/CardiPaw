export interface CalendarAge {
  /** Whole years. */
  years: number;
  /** Whole months on top of `years` (0–11). */
  months: number;
  /** `years * 12 + months`. */
  totalMonths: number;
  /** Local midnight of the birthdate. */
  born: Date;
}

/**
 * Age in whole calendar years and months: a month only counts once its day of
 * the month is reached. `birthdate` is "YYYY-MM-DD" and is read as a local day,
 * not as UTC midnight (which would be the day before west of Greenwich).
 */
export function calendarAge(birthdate: string, now = new Date()): CalendarAge {
  const born = new Date(birthdate + 'T00:00:00');

  let years = now.getFullYear() - born.getFullYear();
  let months = now.getMonth() - born.getMonth();

  if (months < 0) {
    years--;
    months += 12;
  }

  if (now.getDate() < born.getDate()) {
    months--;
    if (months < 0) {
      years--;
      months += 12;
    }
  }

  return { years, months, totalMonths: years * 12 + months, born };
}
