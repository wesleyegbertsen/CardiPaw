import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { fakeMatchMedia } from '../test/mediaQuery';
import { LANDSCAPE_TOUCH_QUERY, useLandscapeTouch } from './useLandscapeTouch';

function inScope() {
  const scope = effectScope();
  const landscape = scope.run(() => useLandscapeTouch())!;
  return { landscape, stop: () => scope.stop() };
}

describe('useLandscapeTouch', () => {
  it('asks for a landscape screen with a coarse pointer: a desktop is landscape too', () => {
    const media = fakeMatchMedia(false);
    inScope();
    expect(media.matchMedia).toHaveBeenCalledExactlyOnceWith(LANDSCAPE_TOUCH_QUERY);
    expect(LANDSCAPE_TOUCH_QUERY).toBe('(orientation: landscape) and (pointer: coarse)');
  });

  it.each([true, false])('starts as the query matches (%s)', (matches) => {
    fakeMatchMedia(matches);
    expect(inScope().landscape.value).toBe(matches);
  });

  it('follows a rotation both ways', () => {
    const media = fakeMatchMedia(false);
    const { landscape } = inScope();
    media.set(true);
    expect(landscape.value).toBe(true);
    media.set(false);
    expect(landscape.value).toBe(false);
  });

  it('stops listening when its scope ends', () => {
    const media = fakeMatchMedia(false);
    const { landscape, stop } = inScope();
    expect(media.listeners.size).toBe(1);
    stop();
    expect(media.listeners.size).toBe(0);
    media.set(true);
    expect(landscape.value).toBe(false);
  });
});
