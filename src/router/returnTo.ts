import type { RouteLocationRaw, Router } from 'vue-router';

/**
 * Leaves the current screen for `target`. When the previous history entry is that screen
 * (same path; the query may differ), steps back to it, so the system/browser back button
 * doesn't return here afterwards. Otherwise, e.g. after opening a link straight to this
 * screen, replaces this entry with `target`.
 */
export function returnTo(router: Router, target: RouteLocationRaw): void {
  const back = router.options.history.state.back;
  if (typeof back === 'string' && router.resolve(back).path === router.resolve(target).path) {
    router.back();
  } else {
    void router.replace(target);
  }
}
