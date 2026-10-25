import { vi } from 'vitest';

/** Makes reading `localStorage` throw, as Chrome and Safari do when site data is blocked. */
export function blockStorage() {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
}

/** Makes every `localStorage.setItem` throw, as a full quota does. */
export function failStorageWrites() {
  // Spy on the instance: a spy on Storage.prototype does not always take effect in happy-dom.
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  });
}
