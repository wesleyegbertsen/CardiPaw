import { ref } from 'vue';
import { readStorage, writeStorage } from '../utils/storage';

const STORAGE_KEY = 'cardipaw-onboarding-seen';
// The camera steps have their own flag: an owner who knows tapping still needs them once.
const CAMERA_STORAGE_KEY = 'cardipaw-camera-onboarding-seen';

const hasSeenOnboarding = ref(readStorage(STORAGE_KEY) === '1');
const hasSeenCameraOnboarding = ref(readStorage(CAMERA_STORAGE_KEY) === '1');

export function useOnboarding() {
  function markSeen() {
    hasSeenOnboarding.value = true;
    writeStorage(STORAGE_KEY, '1');
  }

  function markCameraSeen() {
    hasSeenCameraOnboarding.value = true;
    writeStorage(CAMERA_STORAGE_KEY, '1');
  }

  return { hasSeenOnboarding, markSeen, hasSeenCameraOnboarding, markCameraSeen };
}
