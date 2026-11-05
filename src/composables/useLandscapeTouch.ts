import { onScopeDispose, readonly, ref, type Ref } from 'vue';

/** A phone or tablet held sideways. A desktop browser is landscape too, but its pointer is fine. */
export const LANDSCAPE_TOUCH_QUERY = '(orientation: landscape) and (pointer: coarse)';

/** Whether the screen is a landscape touch screen, following rotations until the scope ends. */
export function useLandscapeTouch(): Readonly<Ref<boolean>> {
  const query = window.matchMedia(LANDSCAPE_TOUCH_QUERY);
  const matches = ref(query.matches);
  const onChange = (e: MediaQueryListEvent) => {
    matches.value = e.matches;
  };
  query.addEventListener('change', onChange);
  onScopeDispose(() => query.removeEventListener('change', onChange));
  return readonly(matches);
}
