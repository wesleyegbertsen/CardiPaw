import type { Reading } from '../types';
import { makeReading } from './fixtures';

/**
 * Readings at local noon for a trend alert test: 10 baseline days at `baseline`
 * (today−12 … today−3, or none when null; an array gives each day's rate, oldest first),
 * then one day per `recent` rate ending today.
 * `today` is local; pass the same day the test sets as the system time.
 */
export function trendReadings(
  today: Date,
  baseline: number | number[] | null,
  recent: number[],
  petId = 'pet-1',
): Reading[] {
  const at = (offset: number, rate: number, i: number) =>
    makeReading({
      id: `trend-${petId}-${i}`,
      petId,
      rate,
      date: new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + offset,
        12,
      ).toISOString(),
    });
  const baselineRates =
    baseline === null ? [] : Array.isArray(baseline) ? baseline : Array<number>(10).fill(baseline);
  const base = baselineRates.map((rate, i) => at(i - baselineRates.length - 2, rate, i));
  return [...base, ...recent.map((rate, i) => at(i - recent.length + 1, rate, 100 + i))];
}
