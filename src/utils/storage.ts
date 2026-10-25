// With site data blocked, Chrome and Safari throw on any access to `localStorage`, even
// reading the property. A full quota makes `setItem` throw. Preferences are not worth
// a blank screen, so these helpers treat storage as optional.

/** The saved value, or null when there is none or storage is unavailable. */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saves the value if storage is available; otherwise it lasts only for this session. */
export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`Could not save ${key}`, e);
  }
}
