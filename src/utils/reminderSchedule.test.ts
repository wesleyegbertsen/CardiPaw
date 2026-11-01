import { describe, expect, it } from 'vitest';
import { stubTimezone } from '../test/timezone';
import { localDayKey } from './date';
import {
  MAX_SLOT,
  planReminders,
  reminderDayKey,
  reminderId,
  type ReminderSetting,
} from './reminderSchedule';

const daily: ReminderSetting = {
  enabled: true,
  time: '22:00',
  days: [0, 1, 2, 3, 4, 5, 6],
  slot: 1,
};
const none = new Set<string>();

describe('planReminders', () => {
  it('plans 14 days, today first, when today’s time is still ahead', () => {
    const plan = planReminders(daily, none, new Date('2026-06-10T08:00:00Z'));
    expect(plan.map((p) => p.dayKey)).toEqual(
      Array.from({ length: 14 }, (_, i) => `2026-06-${String(10 + i).padStart(2, '0')}`),
    );
    expect(plan[0].at.toISOString()).toBe('2026-06-10T22:00:00.000Z');
  });

  it('includes today after its time has passed, so a due reminder is kept', () => {
    const plan = planReminders(daily, none, new Date('2026-06-10T23:00:00Z'));
    expect(plan[0].dayKey).toBe('2026-06-10');
    expect(plan).toHaveLength(14);
  });

  it('only plans the chosen weekdays and skips measured days', () => {
    // 2026-06-10 is a Wednesday.
    const plan = planReminders(
      { ...daily, days: [1, 3] },
      new Set(['2026-06-15']),
      new Date('2026-06-10T08:00:00Z'),
    );
    expect(plan.map((p) => p.dayKey)).toEqual(['2026-06-10', '2026-06-17', '2026-06-22']);
  });

  it('plans nothing when off', () => {
    expect(
      planReminders({ ...daily, enabled: false }, none, new Date('2026-06-10T08:00:00Z')),
    ).toEqual([]);
  });

  it('gives stable ids, unique across pets, that map back to their day', () => {
    const now = new Date('2026-06-10T08:00:00Z');
    const ids = [1, 2, MAX_SLOT].flatMap((slot) =>
      planReminders({ ...daily, slot }, none, now).map((p) => p.id),
    );
    expect(new Set(ids).size).toBe(42);
    expect(Math.max(...ids)).toBeLessThan(2 ** 31);
    expect(reminderDayKey(reminderId(MAX_SLOT, '2243-10-16'))).toBe('2243-10-16');
    expect(reminderId(7, '2026-06-10')).toBe(planReminders({ ...daily, slot: 7 }, none, now)[0].id);
  });

  it('keeps the slot in the ids above the day', () => {
    expect(reminderId(2, '2026-06-10') - reminderId(1, '2026-06-10')).toBe(100_000);
    expect(Math.floor(reminderId(MAX_SLOT, '2026-06-10') / 100_000)).toBe(MAX_SLOT);
  });

  it('finds the weekday of a day in a zone west of UTC', () => {
    stubTimezone('America/Los_Angeles');
    // 08:00 on Wednesday 10 June in Los Angeles.
    const plan = planReminders({ ...daily, days: [1, 3] }, none, new Date('2026-06-10T15:00:00Z'));
    expect(plan.map((p) => p.dayKey)).toEqual([
      '2026-06-10',
      '2026-06-15',
      '2026-06-17',
      '2026-06-22',
    ]);
  });

  it('uses local days and times in Amsterdam, across both DST changes', () => {
    stubTimezone('Europe/Amsterdam');
    const night = { ...daily, time: '02:30' };
    // 29 March 2026: 02:00 → 03:00, so 02:30 doesn't exist and becomes 03:30 CEST.
    const spring = planReminders(night, none, new Date('2026-03-28T12:00:00Z'));
    expect(spring[1].dayKey).toBe('2026-03-29');
    expect(spring[1].at.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // 25 October 2026: 03:00 → 02:00, so 02:30 happens twice; one reminder, at the first.
    const autumn = planReminders(night, none, new Date('2026-10-24T12:00:00Z'));
    expect(autumn.filter((p) => p.dayKey === '2026-10-25').map((p) => p.at.toISOString())).toEqual([
      '2026-10-25T00:30:00.000Z',
    ]);
    // 22:00 local on both sides of the change.
    const evening = planReminders(daily, none, new Date('2026-10-24T12:00:00Z'));
    expect(evening.slice(0, 2).map((p) => p.at.toISOString())).toEqual([
      '2026-10-24T20:00:00.000Z',
      '2026-10-25T21:00:00.000Z',
    ]);
  });

  it('starts from the local day, not the UTC day', () => {
    stubTimezone('Pacific/Auckland');
    // 2026-06-10T20:00Z is already 11 June, 08:00 in Auckland.
    const plan = planReminders(daily, new Set(['2026-06-11']), new Date('2026-06-10T20:00:00Z'));
    expect(plan[0].dayKey).toBe('2026-06-12');
  });

  it('counts a Los Angeles evening reading on that local day, not the UTC one', () => {
    stubTimezone('America/Los_Angeles');
    // 20:00 on 10 June in Los Angeles is already 11 June in UTC.
    const measured = new Set([localDayKey('2026-06-11T03:00:00Z')]);
    const plan = planReminders(
      { ...daily, time: '21:00' },
      measured,
      new Date('2026-06-11T05:00:00Z'),
    );
    expect(plan[0].dayKey).toBe('2026-06-11');
    expect(plan[0].at.toISOString()).toBe('2026-06-12T04:00:00.000Z');
    expect(plan).toHaveLength(13);
  });
});
