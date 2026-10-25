import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChartWindow, weekOffsetOf } from './chartWindow';

const contains = (window: { start: Date; end: Date }, d: Date) =>
  d >= window.start && d <= window.end;

// Europe/Amsterdam: clocks go forward on 31 March 2024 and back on 27 October 2024.
describe('chart windows across DST changes', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Europe/Amsterdam');
  });

  it('starts the week six calendar days back after spring forward', () => {
    const { start, end } = getChartWindow('week', 0, new Date(2024, 3, 1, 0, 30));
    expect(start).toEqual(new Date(2024, 2, 26));
    expect(end).toEqual(new Date(2024, 3, 1, 23, 59, 59, 999));
  });

  it('starts the week six calendar days back after fall back', () => {
    const { start } = getChartWindow('week', 0, new Date(2024, 9, 28, 23, 30));
    expect(start).toEqual(new Date(2024, 9, 22));
  });

  it('puts an early-morning reading six days ago in this week', () => {
    const now = new Date(2024, 2, 12, 8);
    const reading = new Date(2024, 2, 6, 7);
    expect(weekOffsetOf(reading, now)).toBe(0);
    expect(contains(getChartWindow('week', 0, now), reading)).toBe(true);
  });

  it('always finds a reading in the week weekOffsetOf points to', () => {
    const now = new Date(2024, 3, 15, 10);
    const misses: string[] = [];
    for (let h = 0; h < 60 * 24; h++) {
      const reading = new Date(now.getTime() - h * 3_600_000);
      const offset = weekOffsetOf(reading, now);
      if (!contains(getChartWindow('week', offset, now), reading)) {
        misses.push(`${reading.toISOString()} → ${offset}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('getChartWindow', () => {
  it('covers whole local days for week offsets', () => {
    const { start, end } = getChartWindow('week', -2, new Date(2024, 4, 20, 15));
    expect(start).toEqual(new Date(2024, 3, 30));
    expect(end).toEqual(new Date(2024, 4, 6, 23, 59, 59, 999));
  });

  it('goes back to the full previous month from the 31st', () => {
    const { start, end } = getChartWindow('month', -1, new Date(2024, 2, 31, 12));
    expect(start).toEqual(new Date(2024, 1, 1));
    expect(end).toEqual(new Date(2024, 1, 29, 23, 59, 59, 999));
  });

  it('covers a whole calendar year', () => {
    const { start, end } = getChartWindow('year', -1, new Date(2024, 6, 1));
    expect(start).toEqual(new Date(2023, 0, 1));
    expect(end).toEqual(new Date(2023, 11, 31, 23, 59, 59, 999));
  });
});

describe('weekOffsetOf', () => {
  it('returns 0, not -0, for the current week', () => {
    const now = new Date(2024, 4, 20, 15);
    expect(Object.is(weekOffsetOf(new Date(2024, 4, 18), now), 0)).toBe(true);
  });

  it('counts back in whole weeks ending today', () => {
    const now = new Date(2024, 4, 20, 15);
    expect(weekOffsetOf(new Date(2024, 4, 14, 23), now)).toBe(0);
    expect(weekOffsetOf(new Date(2024, 4, 13, 23), now)).toBe(-1);
    expect(weekOffsetOf(new Date(2024, 4, 7), now)).toBe(-1);
    expect(weekOffsetOf(new Date(2024, 4, 6), now)).toBe(-2);
  });
});
