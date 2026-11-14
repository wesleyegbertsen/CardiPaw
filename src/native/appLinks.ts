import { App } from '@capacitor/app';
import type { Router } from 'vue-router';
import { isNative, PUBLIC_ORIGIN } from '../utils/platform';
import { shareRouteFromUrl } from '../utils/shareLink';

/**
 * App only: a cardipaw.com/share/ link opened from another app (an Android App Link) shows
 * the share view. Capacitor holds the event until a listener exists, so this covers a cold
 * start as well as an app that is already running. Anything that is not a share link is
 * ignored, and only the payload is taken from the URL, never a path.
 */
export function installAppLinks(router: Router): void {
  if (!isNative()) return;
  void App.addListener('appUrlOpen', ({ url }) => {
    const route = shareRouteFromUrl(url, { origin: PUBLIC_ORIGIN });
    if (route) void router.push(route);
  });
}
