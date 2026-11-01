import { App } from '@capacitor/app';
import type { Router } from 'vue-router';
import { closeTopModal } from '../composables/useModal';
import { isNative } from '../utils/platform';

/**
 * App only: the system back button closes the open dialog, otherwise goes back a screen;
 * on the home screen it sends the app to the background (Android's convention since 12).
 */
export function installBackButton(router: Router): void {
  if (!isNative()) return;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (closeTopModal()) return;
    if (router.currentRoute.value.name === 'home') {
      void App.minimizeApp();
    } else if (canGoBack) {
      router.back();
    } else {
      // Opened straight onto this screen: there is nothing to go back to but home.
      void router.replace({ name: 'home' });
    }
  });
}
