export type ChartRange = 'week' | 'month' | 'year';

/**
 * The span of local days shown for a chart range. `offset` counts periods back
 * (negative) from the current one; a week is the seven days ending today.
 */
export function getChartWindow(range: ChartRange, offset: number, now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  if (range === 'week') {
    end.setDate(now.getDate() + offset * 7);
    // Calendar arithmetic: subtracting 6×24h lands on the wrong day across a DST change.
    start.setTime(end.getTime());
    start.setDate(end.getDate() - 6);
  } else if (range === 'month') {
    start.setMonth(now.getMonth() + offset, 1);
    end.setMonth(now.getMonth() + offset + 1, 0);
  } else {
    start.setFullYear(now.getFullYear() + offset, 0, 1);
    end.setFullYear(now.getFullYear() + offset, 11, 31);
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** The week offset (as used by getChartWindow) whose window contains `date`. */
export function weekOffsetOf(date: Date, now = new Date()): number {
  // Whole local days, independent of the time of day and of DST.
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  // `|| 0`: Math.ceil gives -0 for the current week.
  return Math.ceil((day(date) - day(now)) / 7) || 0;
}
