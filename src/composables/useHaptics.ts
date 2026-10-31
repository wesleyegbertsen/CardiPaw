import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from '../utils/platform';

export function useHaptics() {
  // The app vibrates through the Haptics plugin; the website uses the Vibration API where it exists.
  const native = isNative();
  const isSupported = native || (typeof navigator !== 'undefined' && 'vibrate' in navigator);

  function vibrate(pattern: number | number[]): void {
    if (!isSupported) return;
    navigator.vibrate(pattern);
  }

  // Haptics are a nicety: a failed vibration must not interrupt the count, so errors are dropped.
  function vibrateTap(): void {
    if (native) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    else vibrate(30);
  }

  function vibrateDone(): void {
    if (native) void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    else vibrate([80, 60, 80]);
  }

  return { isSupported, vibrateTap, vibrateDone };
}
