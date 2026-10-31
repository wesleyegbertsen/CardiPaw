import { App } from '@capacitor/app';
import { checkIfDue } from '../composables/useUpdateCheck';
import { isNative } from '../utils/platform';

/**
 * App only: runs the opt-in update check (about daily, see checkIfDue) at startup and
 * whenever the app returns to the foreground, since Android can keep it running for days.
 */
export function installUpdateCheck(): void {
  if (!isNative()) return;
  void checkIfDue();
  void App.addListener('resume', () => void checkIfDue());
}
