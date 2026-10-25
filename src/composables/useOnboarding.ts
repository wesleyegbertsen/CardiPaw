import { ref } from 'vue';
import { readStorage, writeStorage } from '../utils/storage';

const STORAGE_KEY = 'cardipaw-onboarding-seen';

const hasSeenOnboarding = ref(readStorage(STORAGE_KEY) === '1');

export function useOnboarding() {
  function markSeen() {
    hasSeenOnboarding.value = true;
    writeStorage(STORAGE_KEY, '1');
  }

  return { hasSeenOnboarding, markSeen };
}
