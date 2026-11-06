import { registerPlugin } from '@capacitor/core';

export interface PickedFolder {
  /** The folder's content:// tree URI; Android keeps CardiPaw's access to it (a persisted grant). */
  uri: string;
  /** The folder's name, for Settings. */
  name: string;
}

interface BackupFolderPlugin {
  /** Opens Android's folder picker. Rejects CANCELLED when it is closed without a folder. */
  pickFolder(): Promise<PickedFolder>;
  /** Gives up CardiPaw's access to the folder. Never deletes anything. */
  releaseFolder(options: { uri: string }): Promise<void>;
  /** The folder's name; rejects PERMISSION_REVOKED or FOLDER_MISSING when it can't be used. */
  checkFolder(options: { uri: string }): Promise<{ name: string }>;
  /** Creates or overwrites the backup file `name` (it must match BACKUP_FILE_PATTERN). */
  writeFile(options: { uri: string; name: string; text: string }): Promise<void>;
  /** The names in the folder that match BACKUP_FILE_PATTERN; other files are never listed. */
  listFiles(options: { uri: string }): Promise<{ names: string[] }>;
  /** Deletes the backup file `name` (it must match BACKUP_FILE_PATTERN); a missing file is fine. */
  deleteFile(options: { uri: string; name: string }): Promise<void>;
}

/** App only (android/app/.../BackupFolderPlugin.java): no web implementation. */
export const BackupFolder = registerPlugin<BackupFolderPlugin>('BackupFolder');

/** What Settings tells the owner when a backup can't be written. */
export type BackupFailure = 'revoked' | 'missing' | 'full' | 'failed';

/** The plugin's reject code; undefined for an error that isn't the plugin's. */
export function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function failureOf(e: unknown): BackupFailure {
  switch (errorCode(e)) {
    case 'PERMISSION_REVOKED':
      return 'revoked';
    case 'FOLDER_MISSING':
      return 'missing';
    case 'STORAGE_FULL':
      return 'full';
    default:
      return 'failed';
  }
}
