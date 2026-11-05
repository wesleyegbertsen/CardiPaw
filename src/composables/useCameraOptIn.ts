import { readonly, ref } from 'vue';
import { readStorage, writeStorage } from '../utils/storage';

// This installation's choice, not the pets': not in backups.
const STORAGE_KEY = 'cardipaw-camera-counting';

const enabled = ref(readStorage(STORAGE_KEY) === '1');

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
  }
  return { enabled: readonly(enabled), setEnabled };
}
