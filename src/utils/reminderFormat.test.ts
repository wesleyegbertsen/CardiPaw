import { describe, expect, it } from 'vitest';
import { formatDays, formatReminderTime, orderedWeekdays, weekdayName } from './reminderFormat';
import { stubTimezone } from '../test/timezone';

describe('orderedWeekdays', () => {
  it('starts the week on Sunday or Monday', () => {
    expect(orderedWeekdays(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('weekdayName', () => {
  it('names a weekday short or long', () => {
    expect(weekdayName(0, 'en', 'short')).toBe('Sun');
    expect(weekdayName(6, 'en', 'long')).toBe('Saturday');
  });

  it('names the same day in a zone west of UTC', () => {
    stubTimezone('America/Los_Angeles');
    expect(weekdayName(0, 'en', 'short')).toBe('Sun');
  });
});

describe('formatDays', () => {
  it('lists the chosen days in week order, as each locale writes a list', () => {
    expect(formatDays([5, 1, 3], 'en', 0)).toBe('Mon, Wed, Fri');
    expect(formatDays([1, 3, 5], 'de', 1)).toBe('Mo, Mi und Fr');
    expect(formatDays([1, 3, 5], 'fr', 1)).toBe('lun., mer. et ven.');
    expect(formatDays([1, 3, 5], 'ja', 0)).toBe('月 水 金');
  });

  it('puts Sunday last when the week starts on Monday', () => {
    expect(formatDays([0, 1], 'en', 1)).toBe('Mon, Sun');
    expect(formatDays([0, 1], 'en', 0)).toBe('Sun, Mon');
  });
});

describe('formatReminderTime', () => {
  it('writes the time as the locale does', () => {
    expect(formatReminderTime('22:00', 'en')).toBe('10:00 PM');
    expect(formatReminderTime('22:00', 'nl')).toBe('22:00');
    expect(formatReminderTime('00:30', 'de')).toBe('0:30');
  });

  it('keeps the time in a zone west of UTC', () => {
    stubTimezone('America/Los_Angeles');
    expect(formatReminderTime('22:00', 'en')).toBe('10:00 PM');
  });
});
