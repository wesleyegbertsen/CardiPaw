import type { Reading } from '../types';

/** Lengths a guided measurement can run for. Each divides 60, so rates stay whole numbers. */
export const MEASUREMENT_DURATIONS = [15, 30, 60] as const;
export type MeasurementSeconds = (typeof MEASUREMENT_DURATIONS)[number];
export const DEFAULT_MEASUREMENT_SECONDS: MeasurementSeconds = 30;

export function isMeasurementSeconds(value: unknown): value is MeasurementSeconds {
  return (MEASUREMENT_DURATIONS as readonly unknown[]).includes(value);
}

/** Breaths per minute from the taps counted during a measurement of `seconds`. */
export function breathsPerMinute(taps: number, seconds: MeasurementSeconds): number {
  return Math.round((taps * 60) / seconds);
}

/**
 * How long a reading was measured for: null for a manual entry. Guided readings saved
 * before the length was selectable have no length and ran for 30 seconds.
 */
export function readingSeconds(
  reading: Pick<Reading, 'source' | 'durationSeconds'>,
): MeasurementSeconds | null {
  if (reading.source === 'manual') return null;
  return reading.durationSeconds ?? DEFAULT_MEASUREMENT_SECONDS;
}
