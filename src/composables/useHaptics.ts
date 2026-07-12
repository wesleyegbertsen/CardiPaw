export function useHaptics() {
  const isSupported = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  function vibrate(pattern: number | number[]): void {
    if (!isSupported) return;
    navigator.vibrate(pattern);
  }

  function vibrateTap(): void {
    vibrate(30);
  }

  function vibrateDone(): void {
    vibrate([80, 60, 80]);
  }

  return { isSupported, vibrateTap, vibrateDone };
}
