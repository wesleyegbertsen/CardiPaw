import { ref } from 'vue';

const STORAGE_KEY = 'cardipaw-onboarding-seen';

const hasSeenOnboarding = ref(localStorage.getItem(STORAGE_KEY) === '1');

export function useOnboarding() {
  function markSeen() {
    hasSeenOnboarding.value = true;
    localStorage.setItem(STORAGE_KEY, '1');
  }

  return { hasSeenOnboarding, markSeen };
}
