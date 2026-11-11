// Names, periods and pruning for automatic backups (src/composables/useAutoBackup.ts).
import { localDayKey, shiftDayKey } from './date';

export type BackupFrequency = 'daily' | 'weekly';
export const KEEP_CHOICES = [3, 7, 14, 30] as const;
export const DEFAULT_KEEP = 7;

/** Same pattern as BACKUP_NAME in BackupFolderPlugin.java (androidResources.test.ts keeps them equal). */
export const BACKUP_FILE_PATTERN = /^cardipaw-backup-(\d{4}-\d{2}-\d{2})\.json$/;

/** The local day that starts the period `now` is in: that day, or the Monday of its week. */
export function periodKey(now: Date, frequency: BackupFrequency): string {
  const day = localDayKey(now);
  return frequency === 'daily' ? day : shiftDayKey(day, -((now.getDay() + 6) % 7));
}

export function backupFileName(now: Date, frequency: BackupFrequency): string {
  return `cardipaw-backup-${periodKey(now, frequency)}.json`;
}

/** A name CardiPaw writes: the pattern, with a real calendar day (2026-02-30 is someone else's). */
export function isBackupFileName(name: string): boolean {
  const day = BACKUP_FILE_PATTERN.exec(name)?.[1];
  return day !== undefined && shiftDayKey(day, 0) === day;
}

/**
 * The backups to delete so that `keep` remain: only CardiPaw's own names, newest by the day
 * in the name (not the file's time, which a sync app may change). `current`, the file just
 * written, always stays, even when a clock set back makes it the oldest.
 */
export function filesToPrune(names: readonly string[], keep: number, current: string): string[] {
  const others = [...new Set(names)].filter((n) => n !== current && isBackupFileName(n));
  // Fixed-width names: string order is date order.
  others.sort().reverse();
  return others.slice(Math.max(0, keep - 1));
}
