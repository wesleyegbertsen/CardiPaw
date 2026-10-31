import { Directory, Encoding, Filesystem, type FileInfo } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { v4 as generateId } from 'uuid';

/**
 * Exports are written to this folder in the cache directory, one folder per export. Only this
 * folder is ever cleaned up: the rest of the cache belongs to the WebView. FileProvider shares
 * only this folder (android/app/src/main/res/xml/file_paths.xml), so keep the two in step.
 */
const EXPORTS_DIR = 'exports';
/** The plugin's "does not exist" code (FilesystemErrors.kt): nothing was exported yet. */
const DOES_NOT_EXIST = 'OS-PLUG-FILE-0008';
/**
 * Exports younger than this are kept by the next export and at start-up: the app they were
 * shared to may still open one later (a Gmail draft, a Drive upload), and Android can stop
 * CardiPaw meanwhile.
 */
export const MAX_EXPORT_AGE_MS = 60 * 60 * 1000;

/** 'cancelled': the share sheet was closed without picking an app. */
export type ShareFileOutcome = 'shared' | 'cancelled';

export interface ShareFileOptions {
  /** File name the receiving app sees. */
  name: string;
  /** UTF-8 text, or base64 for binary files. */
  data: string;
  encoding: 'utf8' | 'base64';
  /** The shared content's name, used by apps that take one (the email subject). */
  subject: string;
  /** Shown above the share sheet: what the user is doing. */
  dialogTitle: string;
}

/**
 * App only: writes the file to its own folder in the cache directory and opens the Android
 * share sheet, where it can be saved (Files, Drive) or sent. The WebView ignores
 * <a download>, so this replaces it. Earlier exports older than an hour are deleted first.
 */
export async function shareFile({
  name,
  data,
  encoding,
  subject,
  dialogTitle,
}: ShareFileOptions): Promise<ShareFileOutcome> {
  // Exports younger than an hour are kept: an app they were shared to may still open them
  // later (a Gmail draft, a Drive upload). Not after sharing: Share.share resolves when the
  // sheet closes, while the receiving app may still be reading the file. Before writing, so
  // the new file is never the one removed.
  await cleanUpExports(MAX_EXPORT_AGE_MS);
  const { uri } = await Filesystem.writeFile({
    // A folder per export keeps the name the user sees, and a later export of the same name
    // never overwrites a file another app may still be reading.
    path: `${EXPORTS_DIR}/${generateId()}/${name}`,
    data,
    directory: Directory.Cache,
    recursive: true, // creates the folders
    // Without an encoding the plugin decodes `data` as base64.
    ...(encoding === 'utf8' ? { encoding: Encoding.UTF8 } : {}),
  });
  try {
    await Share.share({ title: subject, dialogTitle, files: [uri] });
  } catch (e) {
    // The Android plugin rejects with exactly this when the sheet is dismissed
    // (SharePlugin.java, activityResult); anything else is a real failure.
    if (e instanceof Error && e.message === 'Share canceled') return 'cancelled';
    throw e;
  }
  return 'shared';
}

/**
 * App only: deletes the exports last modified `olderThanMs` or more ago, or all of them
 * (the default). Never rejects: a leftover file isn't worth failing an export, the app start
 * or a pet delete over, so failures are only logged.
 */
export async function cleanUpExports(olderThanMs = 0): Promise<void> {
  let files: FileInfo[];
  try {
    ({ files } = await Filesystem.readdir({ path: EXPORTS_DIR, directory: Directory.Cache }));
  } catch (e) {
    // The Android bridge copies the plugin's error code onto the rejected error.
    const nothingExported = (e as { code?: unknown } | null)?.code === DOES_NOT_EXIST;
    if (!nothingExported) console.warn('Listing exports failed', e);
    return;
  }
  const cutoff = Date.now() - olderThanMs;
  for (const file of files) {
    // Not when deleting all: the clock may have been turned back since an export.
    if (olderThanMs > 0 && file.mtime > cutoff) continue;
    const path = `${EXPORTS_DIR}/${file.name}`;
    try {
      if (file.type === 'directory') {
        await Filesystem.rmdir({ path, directory: Directory.Cache, recursive: true });
      } else {
        await Filesystem.deleteFile({ path, directory: Directory.Cache });
      }
    } catch (e) {
      // One stuck export doesn't keep the others.
      console.warn('Deleting an export failed', e);
    }
  }
}
