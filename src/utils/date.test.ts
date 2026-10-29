import { describe, expect, it } from 'vitest';
import { localDayKey, localMonthKey, shiftDayKey } from './date';
import { stubTimezone } from '../test/timezone';

describe('localDayKey / localMonthKey', () => {
  it('uses the UTC day when the zone is UTC', () => {
    expect(localDayKey('2024-03-10T23:59:59.999Z')).toBe('2024-03-10');
    expect(localMonthKey('2024-03-31T23:59:59.999Z')).toBe('2024-03');
  });

  it('moves late-UTC readings to the next day east of Greenwich', () => {
    stubTimezone('Asia/Tokyo');
    expect(localDayKey('2024-03-10T14:59:00.000Z')).toBe('2024-03-10');
    expect(localDayKey('2024-03-10T15:00:00.000Z')).toBe('2024-03-11');
    expect(localMonthKey('2024-03-31T15:00:00.000Z')).toBe('2024-04');
  });

  it('moves early-UTC readings to the previous day west of Greenwich', () => {
    stubTimezone('America/New_York');
    expect(localDayKey('2024-03-11T03:59:00.000Z')).toBe('2024-03-10');
    expect(localDayKey('2024-03-11T04:00:00.000Z')).toBe('2024-03-11');
    expect(localMonthKey('2024-03-01T02:00:00.000Z')).toBe('2024-02');
  });

  it('rolls over the year', () => {
    stubTimezone('America/New_York');
    expect(localDayKey('2025-01-01T03:00:00.000Z')).toBe('2024-12-31');
    expect(localMonthKey('2025-01-01T03:00:00.000Z')).toBe('2024-12');
    stubTimezone('Asia/Tokyo');
    expect(localDayKey('2024-12-31T16:00:00.000Z')).toBe('2025-01-01');
  });

  it('keeps the local day on the Amsterdam DST change days', () => {
    stubTimezone('Europe/Amsterdam');
    // Spring forward on 31 March 2024: 23:30 local on the 30th is 22:30 UTC.
    expect(localDayKey('2024-03-30T22:30:00.000Z')).toBe('2024-03-30');
    expect(localDayKey('2024-03-30T23:30:00.000Z')).toBe('2024-03-31');
    expect(localDayKey('2024-03-31T21:59:00.000Z')).toBe('2024-03-31');
    expect(localDayKey('2024-03-31T22:00:00.000Z')).toBe('2024-04-01');
    // Fall back on 27 October 2024.
    expect(localDayKey('2024-10-26T21:59:00.000Z')).toBe('2024-10-26');
    expect(localDayKey('2024-10-26T22:00:00.000Z')).toBe('2024-10-27');
    expect(localDayKey('2024-10-27T22:59:00.000Z')).toBe('2024-10-27');
    expect(localDayKey('2024-10-27T23:00:00.000Z')).toBe('2024-10-28');
  });

  it('accepts Date objects', () => {
    expect(localDayKey(new Date(2024, 1, 29, 23, 59))).toBe('2024-02-29');
    expect(localMonthKey(new Date(2024, 1, 29))).toBe('2024-02');
  });
});

describe('shiftDayKey', () => {
  it('returns the same key for 0 days', () => {
    expect(shiftDayKey('2024-03-20', 0)).toBe('2024-03-20');
  });

  it('crosses month, leap-day and year boundaries', () => {
    expect(shiftDayKey('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDayKey('2023-03-01', -1)).toBe('2023-02-28');
    expect(shiftDayKey('2024-01-01', -1)).toBe('2023-12-31');
    expect(shiftDayKey('2023-12-31', 1)).toBe('2024-01-01');
    expect(shiftDayKey('2024-03-20', -30)).toBe('2024-02-19');
  });

  it('steps one calendar day at a time across DST changes, in any zone', () => {
    for (const tz of ['Europe/Amsterdam', 'America/New_York', 'Pacific/Auckland']) {
      stubTimezone(tz);
      // Amsterdam springs forward on 31 March 2024, New York on 10 March, Auckland falls back on 7 April.
      const keys = Array.from({ length: 40 }, (_, i) => shiftDayKey('2024-04-10', -i));
      expect(new Set(keys).size).toBe(40);
      expect(keys.at(-1)).toBe('2024-03-02');
      // Matches stepping a local Date back day by day.
      const local = new Date(2024, 3, 10, 0, 30);
      keys.forEach((key) => {
        expect(key).toBe(localDayKey(local));
        local.setDate(local.getDate() - 1);
      });
    }
  });
});
