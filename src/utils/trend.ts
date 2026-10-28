import type { Pet, Reading } from '../types';
import { localDayKey, shiftDayKey } from './date';
import { DEFAULT_NORMAL_CEILING } from './rateStatus';

// Trend alerts compare a pet's last few days with the weeks before them. Each local
// calendar day counts once (the median of its readings), so re-measuring a high
// number on the same day can't raise an alert on its own.

export const RECENT_DAYS = 3; // today and the 2 days before
const MIN_RECENT_DAYS = 2; // recent days with readings needed for any alert
export const BASELINE_DAYS = 28; // the 28 days before the recent window
export const MIN_BASELINE_DAYS = 7; // baseline days with readings needed for the rising rule
export const RISE_PERCENT = 20; // a recent day is "raised" at ≥ baseline × 1.20 …
export const RISE_MIN_BREATHS = 4; // … and ≥ baseline + 4 breaths/min
export const MIN_RAISED_DAYS = 2; // raised recent days needed for 'rising'
export const MIN_DAYS_ABOVE_CEILING = 2; // recent days above the Normal ceiling needed for 'aboveCeiling'

type TrendKind = 'none' | 'insufficient' | 'rising' | 'aboveCeiling';

interface TrendCounts {
  baselineDays: number;
  recentDays: number;
  raisedDays: number;
  daysAboveCeiling: number;
  /** The pet's Normal ceiling, or the default. */
  normalCeiling: number;
}

type TrendResult = TrendCounts &
  (
    | { kind: 'rising'; baseline: number; recent: number }
    | {
        kind: Exclude<TrendKind, 'rising'>;
        /** Median of the baseline day values; null with fewer than MIN_BASELINE_DAYS. */
        baseline: number | null;
        /** Mean of the recent day values; null with fewer than MIN_RECENT_DAYS. */
        recent: number | null;
      }
  );

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

export function computeTrend(
  readings: readonly Pick<Reading, 'date' | 'rate'>[],
  pet?: Pick<Pet, 'normalCeiling'>,
  asOf: Date = new Date(),
): TrendResult {
  const today = localDayKey(asOf);
  const recentStart = shiftDayKey(today, -(RECENT_DAYS - 1));
  const baselineEnd = shiftDayKey(recentStart, -1);
  const baselineStart = shiftDayKey(baselineEnd, -(BASELINE_DAYS - 1));

  // Group usable readings by local day. Backup import keeps any finite rate, so skip
  // rates that can't be real, and readings dated after today (a clock that was ahead).
  const byDay = new Map<string, number[]>();
  for (const r of readings) {
    if (!Number.isFinite(r.rate) || r.rate <= 0) continue;
    const date = new Date(r.date);
    if (Number.isNaN(date.getTime())) continue;
    const key = localDayKey(date); // zero-padded, so keys compare as strings
    if (key > today || key < baselineStart) continue;
    const rates = byDay.get(key);
    if (rates) rates.push(r.rate);
    else byDay.set(key, [r.rate]);
  }

  const recentValues: number[] = [];
  const baselineValues: number[] = [];
  for (const [key, rates] of byDay) {
    (key >= recentStart ? recentValues : baselineValues).push(median(rates));
  }

  const normalCeiling = pet?.normalCeiling ?? DEFAULT_NORMAL_CEILING;
  const recent = recentValues.length >= MIN_RECENT_DAYS ? mean(recentValues) : null;
  const baseline = baselineValues.length >= MIN_BASELINE_DAYS ? median(baselineValues) : null;
  const raisedDays =
    baseline === null
      ? 0
      : recentValues.filter(
          // v ≥ baseline × 1.2 without floating-point error for whole numbers
          (v) => v * 100 >= baseline * (100 + RISE_PERCENT) && v - baseline >= RISE_MIN_BREATHS,
        ).length;
  const daysAboveCeiling = recentValues.filter((v) => v > normalCeiling).length;

  const counts: TrendCounts = {
    baselineDays: baselineValues.length,
    recentDays: recentValues.length,
    raisedDays,
    daysAboveCeiling,
    normalCeiling,
  };

  // Comparing the rounded values keeps the message ("about {recent}, up from a usual
  // {baseline}") true when a very low third day pulls the mean down to the baseline.
  if (
    recent !== null &&
    baseline !== null &&
    raisedDays >= MIN_RAISED_DAYS &&
    Math.round(recent) > Math.round(baseline)
  ) {
    return { ...counts, kind: 'rising', baseline, recent };
  }
  let kind: Exclude<TrendKind, 'rising'>;
  if (recent === null) kind = 'insufficient';
  else if (daysAboveCeiling >= MIN_DAYS_ABOVE_CEILING) kind = 'aboveCeiling';
  else kind = baseline === null ? 'insufficient' : 'none';
  return { ...counts, kind, baseline, recent };
}

export const isTrendAlert = (result: TrendResult) =>
  result.kind === 'rising' || result.kind === 'aboveCeiling';
