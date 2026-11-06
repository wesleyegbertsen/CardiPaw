import { App } from '@capacitor/app';
import { onDataChanged } from '../services/db';
import {
  backupIfDue,
  flushPendingBackup,
  noteDataChanged,
  probeFolder,
} from '../composables/useAutoBackup';
import { isNative } from '../utils/platform';

/**
 * App only: automatic backups (Settings > Automatic backups, off by default). Writes after data
 * changes (debounced), at startup and on resume when one is due, and flushes a pending one when
 * the app goes to the background.
 */
export function installAutoBackup(): void {
  if (!isNative()) return;
  onDataChanged(noteDataChanged);
  void probeFolder().then(() => backupIfDue());
  void App.addListener('resume', () => void backupIfDue());
  void App.addListener('pause', () => flushPendingBackup());
}
