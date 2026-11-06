import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CameraCapture from './CameraCapture.vue';
import { createTestI18n } from '../test/i18n';
import { makePet } from '../test/fixtures';

// With the real composable (CameraCapture.test.ts mocks it): the camera opening by itself
// after a grant was remembered, and the grant forgotten when that opening is refused.
const GRANTED = 'cardipaw-camera-granted';

function giveCamera(getUserMedia: () => Promise<MediaStream>) {
  // happy-dom has no mediaDevices; an own property on its navigator, removed after the test.
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  });
  return (navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> })
    .getUserMedia;
}

describe('CameraCapture with a remembered grant', () => {
  afterEach(() => {
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    localStorage.clear();
  });

  it('forgets the grant and shows the refusal when the permission was revoked', async () => {
    localStorage.setItem(GRANTED, '1');
    const getUserMedia = giveCamera(() =>
      Promise.reject(new DOMException('no', 'NotAllowedError')),
    );
    const wrapper = mount(CameraCapture, {
      props: { pet: makePet({ species: 'cat' }) },
      attachTo: document.body,
      global: { plugins: [createTestI18n()] },
    });
    expect(wrapper.find('.title').exists()).toBe(false);
    await flushPromises();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(wrapper.get('[role="alert"]').text()).toContain('Camera access was refused.');
    expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element);
    expect(wrapper.find('.btn-retry').exists()).toBe(true);
    expect(localStorage.getItem(GRANTED)).toBe('0');

    // The owner reads the refusal, not the explanation, and the next visit explains first.
    wrapper.unmount();
    const again = mount(CameraCapture, {
      props: { pet: makePet({ species: 'cat' }) },
      global: { plugins: [createTestI18n()] },
    });
    await flushPromises();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(again.get('.title').text()).toBe('Count breaths with the camera');
  });
});
