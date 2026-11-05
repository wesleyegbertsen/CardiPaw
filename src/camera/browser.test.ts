import { describe, expect, it, vi } from 'vitest';
import { cameraErrorKind, createFrameReader, videoFrames } from './browser.ts';

type Rvfc = (now: number, m: VideoFrameCallbackMetadata) => void;

/** A video whose requestVideoFrameCallback records the latest callback and hands out handle 7. */
function rvfcVideo() {
  const state = { cb: null as Rvfc | null, armed: 0 };
  const video = {
    requestVideoFrameCallback: vi.fn((cb: Rvfc) => {
      state.cb = cb;
      state.armed++;
      return 7;
    }),
    cancelVideoFrameCallback: vi.fn(),
  } as unknown as HTMLVideoElement;
  const meta = (mediaTime: number) => ({ mediaTime }) as VideoFrameCallbackMetadata;
  return { video, state, meta };
}

describe('videoFrames', () => {
  it('uses requestVideoFrameCallback and stops cleanly', () => {
    const { video, state, meta } = rvfcVideo();
    const onFrame = vi.fn();
    const stop = videoFrames(video, onFrame);
    expect(state.armed).toBe(1);
    state.cb!(1, meta(0.5));
    expect(onFrame).toHaveBeenCalledExactlyOnceWith(500);
    expect(state.armed).toBe(2); // re-armed
    stop();
    state.cb!(2, meta(0.533));
    expect(onFrame).toHaveBeenCalledOnce();
    expect(state.armed).toBe(2); // not re-armed after stop
  });

  it('stamps frames with mediaTime when it advances', () => {
    const { video, state, meta } = rvfcVideo();
    const onFrame = vi.fn();
    videoFrames(video, onFrame);
    state.cb!(100, meta(0.5));
    state.cb!(133, meta(0.533));
    state.cb!(166, meta(0.566));
    expect(onFrame.mock.calls.map(([t]) => Math.round(t))).toEqual([500, 533, 566]);
  });

  it('falls back to the callback clock when mediaTime stays at 0 (a live stream on some WebViews)', () => {
    const { video, state, meta } = rvfcVideo();
    const onFrame = vi.fn();
    videoFrames(video, onFrame);
    for (const now of [100, 133, 166]) state.cb!(now, meta(0));
    // The first frame is never part of a window: a capture starts seconds later.
    expect(onFrame.mock.calls.map(([t]) => t)).toEqual([0, 133, 166]);
  });

  it('cancels the pending video frame callback on stop', () => {
    const { video } = rvfcVideo();
    const stop = videoFrames(video, vi.fn());
    stop();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('falls back to requestAnimationFrame deduplicated on currentTime', () => {
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => rafs.push(cb)),
    );
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const video = { currentTime: 0 } as HTMLVideoElement;
    const onFrame = vi.fn();
    const stop = videoFrames(video, onFrame);
    rafs[0](0); // currentTime 0 differs from the initial -1: one frame
    rafs[1](16); // same currentTime: no frame
    video.currentTime = 0.033;
    rafs[2](33);
    expect(onFrame).toHaveBeenCalledTimes(2);
    stop();
    expect(cancel).toHaveBeenCalledWith(rafs.length);
    rafs[rafs.length - 1](50); // a frame that was already queued does nothing after stop
    expect(onFrame).toHaveBeenCalledTimes(2);
  });
});

describe('createFrameReader', () => {
  it('throws where canvas 2D is unavailable (happy-dom)', () => {
    expect(() => createFrameReader()).toThrow('Canvas 2D is unavailable');
  });
});

describe('cameraErrorKind', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['TypeError', 'failed'],
  ])('%s is %s', (name, kind) => {
    expect(cameraErrorKind(new DOMException('x', name))).toBe(kind);
  });

  it('is failed for a non-error', () => {
    expect(cameraErrorKind('boom')).toBe('failed');
  });
});
