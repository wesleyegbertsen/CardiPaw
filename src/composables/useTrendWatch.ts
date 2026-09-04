import { computed, type Ref } from 'vue';
import type { Reading } from '../types';

// A pet's own history is a better yardstick than the fixed 30/35 ceilings:
// a cat that normally sits at 18 and now sits at 28 is still labelled "Normal"
// by getRateStatus(), yet that is a 55% rise — exactly the pattern worth
// mentioning to a vet. Trend Watch compares recent readings against the pet's
// own usual range instead of an absolute threshold.

/** Days of history the usual range is built from (ending where the recent window starts). */
export const BASELINE_WINDOW_DAYS = 30;
/** Days counted as "recent". Wide enough that measuring every other day still fills it. */
export const RECENT_WINDOW_DAYS = 5;
/** Below this the usual range is too noisy to compare against. */
export const MIN_BASELINE_READINGS = 8;
/** More than one recent reading, so a single odd measurement cannot raise a flag on its own. */
export const MIN_RECENT_READINGS = 2;

export const WATCH_THRESHOLD_PCT = 10;
export const RISING_THRESHOLD_PCT = 20;

export type TrendState =
  | 'insufficient' // not enough history yet — say nothing rather than something wrong
  | 'calm'
  | 'watch'
  | 'rising';

/** Every state except the one that renders nothing. */
export type ReportedTrendState = Exclude<TrendState, 'insufficient'>;

// Spelled out rather than built by concatenating a prefix with the state name: these
// stay greppable, and the locale tooling can only check keys it can see as literals.
export const TREND_STATE_KEY: Record<ReportedTrendState, string> = {
  calm: 'trend.stateCalm',
  watch: 'trend.stateWatch',
  rising: 'trend.stateRising',
};

export const TREND_BODY_KEY: Record<ReportedTrendState, string> = {
  calm: 'trend.bodyCalm',
  watch: 'trend.bodyWatch',
  rising: 'trend.bodyRising',
};

export interface TrendWatch {
  state: TrendState;
  /** Median of the baseline window, or null when there is not enough history. */
  baseline: number | null;
  /** Median of the recent window, or null when there is not enough history. */
  current: number | null;
  /** Signed rise of current over baseline, as a fraction (0.21 = 21% above usual). */
  deviation: number | null;
  baselineCount: number;
  recentCount: number;
}

const INSUFFICIENT = (baselineCount: number, recentCount: number): TrendWatch => ({
  state: 'insufficient',
  baseline: null,
  current: null,
  deviation: null,
  baselineCount,
  recentCount,
});

/** Median is used over mean so one reading taken while the pet was dreaming cannot skew the range. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const MS_PER_DAY = 86_400_000;

/**
 * Which band a current reading falls into relative to a usual range. Shared so a
 * report rebuilt from a stored baseline and current — a share link, say — lands on
 * the same wording the app showed when the snapshot was taken.
 */
export function classifyTrend(baseline: number, current: number): TrendState {
  if (baseline <= 0) return 'insufficient';
  const pct = ((current - baseline) / baseline) * 100;
  if (pct >= RISING_THRESHOLD_PCT) return 'rising';
  if (pct >= WATCH_THRESHOLD_PCT) return 'watch';
  return 'calm';
}

export function computeTrendWatch(readings: Reading[], now: number = Date.now()): TrendWatch {
  const recentStart = now - RECENT_WINDOW_DAYS * MS_PER_DAY;
  const baselineStart = recentStart - BASELINE_WINDOW_DAYS * MS_PER_DAY;

  const baselineRates: number[] = [];
  const recentRates: number[] = [];

  for (const r of readings) {
    const t = new Date(r.date).getTime();
    if (Number.isNaN(t)) continue;
    // The windows do not overlap: a sustained rise would otherwise drag its own
    // baseline upwards and mask itself.
    if (t >= recentStart) recentRates.push(r.rate);
    else if (t >= baselineStart) baselineRates.push(r.rate);
  }

  if (baselineRates.length < MIN_BASELINE_READINGS || recentRates.length < MIN_RECENT_READINGS) {
    return INSUFFICIENT(baselineRates.length, recentRates.length);
  }

  const baseline = median(baselineRates);
  const current = median(recentRates);
  if (baseline <= 0) return INSUFFICIENT(baselineRates.length, recentRates.length);

  const deviation = (current - baseline) / baseline;

  return {
    state: classifyTrend(baseline, current),
    baseline,
    current,
    deviation,
    baselineCount: baselineRates.length,
    recentCount: recentRates.length,
  };
}

export function useTrendWatch(readings: Ref<Reading[]>) {
  return computed(() => computeTrendWatch(readings.value));
}
