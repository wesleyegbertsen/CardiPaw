import type { Reading } from '../types';

/** Lengths a guided measurement can run for. */
export const MEASUREMENT_OPTIONS = [15, 30, 60] as const;

/** Length of a guided measurement, in seconds. */
export type MeasurementSeconds = (typeof MEASUREMENT_OPTIONS)[number];

/** Every guided reading made before the length could be chosen ran for 30 seconds. */
export const DEFAULT_MEASUREMENT_SECONDS: MeasurementSeconds = 30;

export function isMeasurementSeconds(value: unknown): value is MeasurementSeconds {
  return (MEASUREMENT_OPTIONS as readonly unknown[]).includes(value);
}

/** How long a guided reading counted for; readings without a length are from before the choice. */
export function readingSeconds(reading: Pick<Reading, 'durationSeconds'>): MeasurementSeconds {
  return reading.durationSeconds ?? DEFAULT_MEASUREMENT_SECONDS;
}

/** Breaths per minute from the taps counted over a measurement of `seconds`. */
export function rateFromTaps(taps: number, seconds: MeasurementSeconds): number {
  return (taps * 60) / seconds;
}
