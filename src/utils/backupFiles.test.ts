import { describe, expect, it } from 'vitest';
import { backupFileName, filesToPrune, isBackupFileName, periodKey } from './backupFiles';
import { stubTimezone } from '../test/timezone';

const name = (day: string) => `cardipaw-backup-${day}.json`;
// Local wall-clock times (month is 0-based), so these hold in any process timezone.
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe('backupFileName', () => {
  it('uses the local day, not the UTC one', () => {
    stubTimezone('America/New_York');
    expect(backupFileName(new Date('2026-11-07T04:30:00Z'), 'daily')).toBe(name('2026-11-06'));
    stubTimezone('Pacific/Auckland');
    expect(backupFileName(new Date('2026-11-06T11:30:00Z'), 'daily')).toBe(name('2026-11-07'));
  });

  it('names a week by its Monday', () => {
    expect(periodKey(local(2026, 11, 8), 'weekly')).toBe('2026-11-02'); // Sunday
    expect(periodKey(local(2026, 11, 2, 0, 0), 'weekly')).toBe('2026-11-02'); // Monday, midnight
    expect(periodKey(local(2026, 1, 1), 'weekly')).toBe('2025-12-29'); // Thursday, across a year
  });

  it('keeps days and weeks whole across a DST change', () => {
    stubTimezone('Europe/Amsterdam');
    // Sunday 25 October 2026: clocks go back at 03:00, so the day has 25 hours.
    expect(backupFileName(new Date('2026-10-25T22:30:00Z'), 'daily')).toBe(name('2026-10-25')); // 23:30 CET
    expect(periodKey(new Date('2026-10-25T22:30:00Z'), 'weekly')).toBe('2026-10-19');
    expect(periodKey(new Date('2026-10-25T23:30:00Z'), 'weekly')).toBe('2026-10-26'); // Monday 00:30
    // Sunday 29 March 2026: clocks go forward at 02:00, a 23-hour day.
    expect(backupFileName(new Date('2026-03-28T23:30:00Z'), 'daily')).toBe(name('2026-03-29')); // 00:30 CET
    expect(periodKey(new Date('2026-03-29T21:59:00Z'), 'weekly')).toBe('2026-03-23'); // 23:59 CEST
  });
});

describe('isBackupFileName', () => {
  it('accepts only the names CardiPaw writes', () => {
    expect(isBackupFileName(name('2026-11-06'))).toBe(true);
    for (const other of [
      'cardipaw-export-2026-11-06.json',
      'cardipaw-backup-2026-11-06 (1).json',
      'cardipaw-backup-2026-11-06.json.tmp',
      'CARDIPAW-BACKUP-2026-11-06.JSON',
      name('2026-02-30'),
      name('2026-13-01'),
    ])
      expect(isBackupFileName(other), other).toBe(false);
  });
});

describe('filesToPrune', () => {
  const days = ['2026-11-01', '2026-11-03', '2026-11-02', '2026-11-05', '2026-11-04'].map(name);

  it('keeps the newest by the day in the name, whatever the order', () => {
    expect(filesToPrune(days, 3, name('2026-11-05'))).toEqual([
      name('2026-11-02'),
      name('2026-11-01'),
    ]);
  });

  it('never deletes the file just written, even when it is the oldest', () => {
    expect(filesToPrune(days, 3, name('2026-10-01'))).toEqual([
      name('2026-11-03'),
      name('2026-11-02'),
      name('2026-11-01'),
    ]);
  });

  it("leaves other files alone and deletes nothing when there aren't more than keep", () => {
    const mixed = [
      'notes.txt',
      'cardipaw-export-2026-01-01.json',
      name('2026-11-04'),
      name('2026-11-05'),
      name('2026-11-05'),
    ];
    expect(filesToPrune(mixed, 3, name('2026-11-05'))).toEqual([]);
  });

  it('counts a name listed twice once, so it never pushes another backup out', () => {
    const listed = [name('2026-11-01'), name('2026-11-01'), name('2026-11-02'), name('2026-11-03')];
    expect(filesToPrune(listed, 3, name('2026-11-03'))).toEqual([]);
    expect(filesToPrune(listed, 2, name('2026-11-03'))).toEqual([name('2026-11-01')]);
  });
});
