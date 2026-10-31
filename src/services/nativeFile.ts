import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** 'cancelled': the share sheet was closed without picking an app. */
export type ShareFileOutcome = 'shared' | 'cancelled';

export interface ShareFileOptions {
  /** File name in the app's cache directory; a later export with the same name overwrites it. */
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
 * App only: writes the file to the cache directory and opens the Android share sheet, where
 * it can be saved (Files, Drive) or sent. The WebView ignores <a download>, so this replaces it.
 */
export async function shareFile({
  name,
  data,
  encoding,
  subject,
  dialogTitle,
}: ShareFileOptions): Promise<ShareFileOutcome> {
  const { uri } = await Filesystem.writeFile({
    path: name,
    data,
    directory: Directory.Cache,
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
