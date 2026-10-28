import type { Reading } from '../types';
import { makeReading } from './fixtures';

/**
 * Readings at local noon for a trend alert test: 10 baseline days at `baseline`
 * (today−12 … today−3, or none when null), then one day per `recent` rate ending today.
 * `today` is local; pass the same day the test sets as the system time.
 */
export function trendReadings(
  today: Date,
  baseline: number | null,
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
  const base =
    baseline === null ? [] : Array.from({ length: 10 }, (_, i) => at(i - 12, baseline, i));
  return [...base, ...recent.map((rate, i) => at(i - recent.length + 1, rate, 100 + i))];
}
