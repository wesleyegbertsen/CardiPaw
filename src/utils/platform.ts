import { Capacitor } from '@capacitor/core';
import { shareLinkUrl } from './shareLink';

/** True inside the Android (Capacitor) app, false on the website. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** The public site: links that leave the app point here, not at the app's https://localhost. */
export const PUBLIC_ORIGIN = 'https://cardipaw.com/';

/** The link other people open for an encoded share payload. */
export function publicShareUrl(encoded: string): string {
  return shareLinkUrl(encoded, isNative() ? PUBLIC_ORIGIN : window.location.origin);
}
