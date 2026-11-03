import { onScopeDispose } from 'vue';

/**
 * Keeps the screen on between acquire() and release(), through the Screen Wake Lock API
 * (the Android app's WebView has it too). Released when the calling component unmounts.
 */
export function useWakeLock() {
  // happy-dom and older browsers lack the API; TypeScript declares it always present.
  const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  // Whether the caller wants the lock now. A request settles later, so it checks this again.
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;
  let requesting = false;

  function request(): void {
    // `released` turns true when the browser drops the lock (the page was hidden).
    if (requesting || (sentinel && !sentinel.released)) return;
    requesting = true;
    navigator.wakeLock.request('screen').then(
      (lock) => {
        requesting = false;
        // Released (or unmounted) while the request was pending: let go at once.
        if (wanted) sentinel = lock;
        else void lock.release();
      },
      // Keeping the screen on is a nicety: a refusal (battery saver, policy) must not
      // interrupt the count, so it is logged and the count goes on.
      (e) => {
        requesting = false;
        console.warn('Keeping the screen on failed', e);
      },
    );
  }

  // The browser drops the lock when the page is hidden; take it again on return.
  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') request();
  }

  function acquire(): void {
    if (!isSupported) return;
    wanted = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
    request();
  }

  function release(): void {
    wanted = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    // release() never rejects: it resolves even for a lock the browser already dropped.
    void sentinel?.release();
    sentinel = null;
  }

  onScopeDispose(release);

  return { acquire, release };
}
