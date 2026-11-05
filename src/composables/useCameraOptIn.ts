import { readonly, ref } from 'vue';
import { readStorage, writeStorage } from '../utils/storage';

// This installation's choice, not the pets': not in backups.
const STORAGE_KEY = 'cardipaw-camera-counting';

// Set once getUserMedia resolved on this device; the camera then opens without the explanation.
// Not navigator.permissions: Android's WebView does not report the camera there reliably.
const GRANTED_KEY = 'cardipaw-camera-granted';

const enabled = ref(readStorage(STORAGE_KEY) === '1');

/** The camera was allowed here before and not refused since. */
export function hasCameraGrant(): boolean {
  return readStorage(GRANTED_KEY) === '1';
}
export function rememberCameraGrant(): void {
  writeStorage(GRANTED_KEY, '1');
}
export function forgetCameraGrant(): void {
  writeStorage(GRANTED_KEY, '0');
}

/** getUserMedia exists here (secure context, a browser that has it). Not whether a camera exists. */
export function isCameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** The Settings opt-in for the experimental camera counting; off until turned on. */
export function useCameraOptIn() {
  function setEnabled(value: boolean) {
    enabled.value = value;
    writeStorage(STORAGE_KEY, value ? '1' : '0');
    // Turned on again later, the camera mode starts with its explanation.
    if (!value) forgetCameraGrant();
  }
  return { enabled: readonly(enabled), setEnabled };
}
