import { Capacitor } from '@capacitor/core';

/** True inside the Android (Capacitor) app, false on the website. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** The public site: links that leave the app point here, not at the app's https://localhost. */
export const PUBLIC_ORIGIN = 'https://cardipaw.com/';

/** Absolute URL for an app href that other people open (share links). */
export function publicUrl(href: string): string {
  return new URL(href, isNative() ? PUBLIC_ORIGIN : window.location.href).href;
}
