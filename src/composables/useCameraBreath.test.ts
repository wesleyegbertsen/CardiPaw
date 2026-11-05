import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useCameraBreath, type CameraBreathDeps } from './useCameraBreath';
import { estimate } from '../camera/estimate';
import { makeScene, type SceneParams } from '../camera/synth';
import type { Frame } from '../camera/motion';
import { deferred } from '../test/deferred';

// Real estimator, but one test makes it throw to exercise the failure path.
vi.mock('../camera/estimate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../camera/estimate')>();
  return { ...real, estimate: vi.fn(real.estimate) };
});

const NTSC = 1000 / 29.97;
// 96×72 like motion.scene.test.ts: a full-size 60 s scene takes seven seconds under coverage.
const SCENE: SceneParams = {
  seed: 1,
  width: 96,
  height: 72,
  fps: 30,
  seconds: 66,
  bpm: 24,
  amplitudePx: 2,
  contrast: 20,
};
/** A flat frame for tests about timing, not about the reading: the tracker rejects it cheaply. */
const FLAT: Frame = { width: 32, height: 24, data: new Uint8Array(32 * 24).fill(120) };
const DARK: Frame = { width: 32, height: 24, data: new Uint8Array(32 * 24).fill(10) };

let scope: EffectScope;

function fakeTrack() {
  return { stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
}
const streamOf = (track: ReturnType<typeof fakeTrack>) =>
  ({ getTracks: () => [track] }) as unknown as MediaStream;

function setup(
  params: SceneParams | Frame = SCENE,
  pet?: { normalCeiling?: number; elevatedCeiling?: number },
) {
  const track = fakeTrack();
  const stream = streamOf(track);
  const video = ref({
    play: vi.fn().mockResolvedValue(undefined),
    srcObject: null,
  } as unknown as HTMLVideoElement);
  const frames = 'seed' in params ? makeScene(params).frames() : null;
  let onFrame: ((t: number) => void) | null = null;
  const stopFrames = vi.fn();
  const getUserMedia = vi
    .fn<NonNullable<CameraBreathDeps['getUserMedia']>>()
    .mockResolvedValue(stream);
  const frameSource = vi.fn<NonNullable<CameraBreathDeps['frameSource']>>((_v, cb) => {
    onFrame = cb;
    return stopFrames;
  });
  const deps: CameraBreathDeps = {
    getUserMedia,
    frameSource,
    readFrame: () => (frames ? (frames.next().value as Frame) : (params as Frame)),
  };
  scope = effectScope();
  const cam = scope.run(() => useCameraBreath({ pet: ref(pet), video, deps }))!;
  let t = 0;
  let advanced = 0;
  /** Delivers n frames, each `periodMs` after the last, advancing the fake clock with them. */
  const feed = (n: number, periodMs = NTSC) => {
    for (let i = 0; i < n; i++) {
      t += periodMs;
      const target = Math.floor(t);
      vi.advanceTimersByTime(target - advanced);
      advanced = target;
      onFrame!(t);
    }
  };
  /**
   * Feeds frames at the NTSC period until a timer during the advance makes `done` true, then
   * delivers the next frame `stallMs` after the previous one: the main thread was blocked and
   * the frames presented meanwhile were coalesced into that one callback.
   */
  const feedThenStall = (done: () => boolean, stallMs: number) => {
    for (let i = 0; i < 2000; i++) {
      const next = t + NTSC;
      vi.advanceTimersByTime(Math.floor(next) - advanced);
      advanced = Math.floor(next);
      if (done()) {
        t += stallMs;
        vi.advanceTimersByTime(Math.floor(t) - advanced);
        advanced = Math.floor(t);
        onFrame!(t);
        return;
      }
      t = next;
      onFrame!(t);
    }
    throw new Error('feedThenStall: never done');
  };
  const trackListener = (type: string) =>
    track.addEventListener.mock.calls.find(([name]) => name === type)![1] as () => void;
  return {
    cam,
    track,
    stopFrames,
    frameSource,
    getUserMedia,
    video,
    feed,
    feedThenStall,
    trackListener,
  };
}

async function openAndPlace(s: ReturnType<typeof setup>) {
  await s.cam.open();
  await flushPromises();
  expect(s.cam.phase.value).toBe('placing');
  s.feed(70); // 2.3 s of still, lit frames
  expect(s.cam.placement.value.steady).toBe(true);
  s.cam.begin();
  expect(s.cam.phase.value).toBe('capturing');
}

describe('useCameraBreath', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T12:00:00.000Z'));
    // The first placement sample is logged in dev builds (vitest runs as dev).
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
  });

  it('asks for the environment camera and reaches placing', async () => {
    const s = setup();
    await s.cam.open();
    expect(s.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(s.cam.phase.value).toBe('placing');
    expect(s.video.value!.srcObject).not.toBeNull();
    expect(s.cam.error.value).toBeNull();
    s.feed(2);
    expect(console.debug).toHaveBeenCalledExactlyOnceWith(
      'camera placement',
      expect.objectContaining({ luma: expect.any(Number) }),
    );
  });

  it('maps a refusal to denied with nothing to stop', async () => {
    const s = setup();
    s.getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    await s.cam.open();
    expect(s.cam.phase.value).toBe('error');
    expect(s.cam.error.value).toBe('denied');
    expect(s.track.stop).not.toHaveBeenCalled();
  });

  it.each([
    ['NotFoundError', 'no-camera'],
    ['NotReadableError', 'busy'],
    ['TypeError', 'failed'],
  ])('maps a %s rejection to %s', async (name, kind) => {
    const s = setup();
    s.getUserMedia.mockRejectedValueOnce(new DOMException('no', name));
    await s.cam.open();
    expect(s.cam.phase.value).toBe('error');
    expect(s.cam.error.value).toBe(kind);
  });

  it('is unsupported without getUserMedia (happy-dom has no mediaDevices)', async () => {
    scope = effectScope();
    const cam = scope.run(() =>
      useCameraBreath({ pet: ref(undefined), video: ref(null), deps: {} }),
    )!;
    await cam.open();
    expect(cam.phase.value).toBe('error');
    expect(cam.error.value).toBe('unsupported');
  });

  it('fails when the preview cannot play, and stops the track', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = setup();
    (s.video.value!.play as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'));
    await s.cam.open();
    expect(s.cam.phase.value).toBe('error');
    expect(s.cam.error.value).toBe('failed');
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('Camera preview failed', expect.any(Error));
  });

  it('accepts a clean 30 s capture at 24 bpm and stops the track', async () => {
    const s = setup();
    await openAndPlace(s);
    s.feed(915); // the window plus the tick and the deferred evaluation, frames all along
    expect(s.cam.phase.value).toBe('done');
    expect(s.cam.verdict.value).toMatchObject({
      seconds: 30,
      accepted: true,
      rate: 24,
      interval: [23, 25],
      reasons: [],
    });
    expect(s.cam.verdict.value!.deliveredFps).toBeCloseTo(29.97, 1);
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.stopFrames).toHaveBeenCalledOnce();
    expect(s.video.value!.srcObject).toBeNull();
    expect(s.cam.elapsedSeconds.value).toBe(30);
    // The owner looks at the result: nothing ticks on to overwrite it.
    const verdict = s.cam.verdict.value;
    vi.advanceTimersByTime(10_000);
    expect(s.cam.phase.value).toBe('done');
    expect(s.cam.verdict.value).toBe(verdict);
  }, 15_000);

  it('extends to 60 s when the 30 s reading is within 1 bpm of a ceiling', async () => {
    const s = setup({ ...SCENE, bpm: 31 });
    await openAndPlace(s);
    s.feed(915);
    expect(s.cam.phase.value).toBe('capturing');
    expect(s.cam.extending.value).toBe(true);
    expect(s.cam.targetSeconds.value).toBe(60);
    s.feed(910);
    expect(s.cam.phase.value).toBe('done');
    expect(s.cam.verdict.value).toMatchObject({
      seconds: 60,
      accepted: true,
      rate: 31,
      interval: [30, 32],
    });
    expect(s.track.stop).toHaveBeenCalledOnce();
  }, 15_000);

  it('forgives the frame gap the 30 s evaluation itself causes', async () => {
    const s = setup({ ...SCENE, bpm: 31 });
    await openAndPlace(s);
    s.feed(880);
    s.feedThenStall(() => s.cam.extending.value, 150);
    s.feed(935);
    expect(s.cam.phase.value).toBe('done');
    expect(s.cam.verdict.value).toMatchObject({ seconds: 60, accepted: true, rate: 31 });
  }, 15_000);

  it('still refuses a 150 ms gap that the evaluation did not cause', async () => {
    const s = setup({ ...SCENE, bpm: 31 });
    await openAndPlace(s);
    s.feed(915);
    expect(s.cam.extending.value).toBe(true);
    s.feed(300);
    s.feed(1, 150);
    s.feed(615);
    expect(s.cam.verdict.value).toMatchObject({
      seconds: 60,
      accepted: false,
      reasons: ['frame-rate'],
    });
  }, 15_000);

  it("extends when the 30 s reading is exactly 1 bpm from the pet's own ceiling", async () => {
    // 24 bpm against the default ceilings (30, 35) finishes at 30 s; against a pet whose
    // normal ceiling is 25 it is within 1 bpm and needs the 60 s quantum.
    const s = setup(SCENE, { normalCeiling: 25, elevatedCeiling: 35 });
    await openAndPlace(s);
    s.feed(915);
    expect(s.cam.phase.value).toBe('capturing');
    expect(s.cam.extending.value).toBe(true);
    s.feed(910);
    expect(s.cam.verdict.value).toMatchObject({ seconds: 60, accepted: true, rate: 24 });
  }, 15_000);

  it('ends at 30 s with frame-rate on a 15 fps run', async () => {
    const s = setup(FLAT);
    await openAndPlace(s);
    s.feed(30, 1000 / 15);
    // Flat frames track nothing: the first hint batch says so.
    expect(s.cam.hints.value).toEqual({ shake: false, fewTracks: true, tooDark: false });
    s.feed(435, 1000 / 15);
    expect(s.cam.phase.value).toBe('done');
    expect(s.cam.verdict.value).toMatchObject({
      accepted: false,
      rate: null,
      reasons: ['frame-rate'],
      estimate: null,
    });
    expect(s.cam.verdict.value!.deliveredFps).toBeCloseTo(15, 1);
  });

  it('ends at 30 s with frame-rate after one 120 ms gap', async () => {
    const s = setup(FLAT);
    await openAndPlace(s);
    s.feed(450);
    s.feed(1, 120);
    s.feed(465);
    expect(s.cam.verdict.value).toMatchObject({ accepted: false, reasons: ['frame-rate'] });
  });

  it('aborts as interrupted when the page is hidden and stops the track', async () => {
    const s = setup(FLAT);
    await openAndPlace(s);
    s.feed(100);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(s.cam.phase.value).toBe('error');
    expect(s.cam.error.value).toBe('interrupted');
    expect(s.cam.verdict.value).toBeNull();
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('ends with frame-rate when the camera stops delivering', async () => {
    const s = setup(FLAT);
    await openAndPlace(s);
    s.feed(100);
    vi.advanceTimersByTime(34_000); // the clock runs on, no frames
    expect(s.cam.phase.value).toBe('done');
    expect(s.cam.verdict.value).toMatchObject({ accepted: false, reasons: ['frame-rate'] });
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('stops the track when its scope is disposed while placing', async () => {
    const s = setup();
    await s.cam.open();
    scope.stop();
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.stopFrames).toHaveBeenCalledOnce();
    scope = effectScope(); // afterEach stops it again harmlessly
  });

  it('returns to idle on cancel() while placing, with the track stopped', async () => {
    const s = setup();
    await s.cam.open();
    s.cam.cancel();
    expect(s.cam.phase.value).toBe('idle');
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.video.value!.srcObject).toBeNull();
  });

  it('stops a stream that arrives after cancel() while the prompt was open', async () => {
    const s = setup();
    const prompt = deferred<MediaStream>();
    s.getUserMedia.mockReturnValueOnce(prompt.promise);
    const opening = s.cam.open();
    expect(s.cam.phase.value).toBe('requesting');
    s.cam.cancel();
    expect(s.cam.phase.value).toBe('idle');
    prompt.resolve(streamOf(s.track));
    await opening;
    await flushPromises();
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(s.cam.phase.value).toBe('idle');
    expect(s.video.value!.srcObject).toBeNull();
  });

  it('stays idle when cancel() comes while play() is pending, with nothing running', async () => {
    const s = setup();
    const playing = deferred<void>();
    (s.video.value!.play as ReturnType<typeof vi.fn>).mockReturnValueOnce(playing.promise);
    const opening = s.cam.open();
    await flushPromises(); // getUserMedia resolved; play() pending
    expect(s.cam.phase.value).toBe('requesting');
    s.cam.cancel();
    playing.resolve();
    await opening;
    expect(s.cam.phase.value).toBe('idle');
    expect(s.cam.error.value).toBeNull();
    expect(s.frameSource).not.toHaveBeenCalled();
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('stays idle when a refusal arrives after cancel()', async () => {
    const s = setup();
    const prompt = deferred<MediaStream>();
    s.getUserMedia.mockReturnValueOnce(prompt.promise);
    const opening = s.cam.open();
    s.cam.cancel();
    prompt.reject(new DOMException('no', 'NotAllowedError'));
    await opening;
    expect(s.cam.phase.value).toBe('idle');
    expect(s.cam.error.value).toBeNull();
  });

  it('keeps only the second stream when opened again while the first prompt was open', async () => {
    const s = setup();
    const first = deferred<MediaStream>();
    const second = deferred<MediaStream>();
    s.getUserMedia.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstTrack = fakeTrack();
    const opening1 = s.cam.open();
    s.cam.cancel();
    const opening2 = s.cam.open();
    first.resolve(streamOf(firstTrack));
    await opening1;
    expect(firstTrack.stop).toHaveBeenCalledOnce();
    expect(s.cam.phase.value).toBe('requesting');
    second.resolve(streamOf(s.track));
    await opening2;
    expect(s.cam.phase.value).toBe('placing');
    expect(s.track.stop).not.toHaveBeenCalled();
  });

  it('interrupts on a rotation while capturing, not on a height-only resize', async () => {
    const s = setup(FLAT);
    await openAndPlace(s);
    const width = window.innerWidth;
    window.dispatchEvent(new Event('resize')); // the URL bar collapsed: same width
    expect(s.cam.phase.value).toBe('capturing');
    window.innerWidth = width + 300;
    window.dispatchEvent(new Event('resize'));
    window.innerWidth = width;
    expect(s.cam.phase.value).toBe('error');
    expect(s.cam.error.value).toBe('interrupted');
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('resets steadiness on a rotation while placing', async () => {
    const s = setup(FLAT);
    await s.cam.open();
    s.feed(70);
    expect(s.cam.placement.value.steady).toBe(true);
    const width = window.innerWidth;
    window.innerWidth = width + 300;
    window.dispatchEvent(new Event('orientationchange'));
    window.dispatchEvent(new Event('resize'));
    window.innerWidth = width;
    s.feed(1);
    expect(s.cam.phase.value).toBe('placing');
    expect(s.cam.placement.value.steady).toBe(false);
    s.feed(70);
    expect(s.cam.placement.value.steady).toBe(true);
  });

  it('resets steadiness on a track mute while placing and interrupts on one while capturing', async () => {
    const s = setup(FLAT);
    await s.cam.open();
    s.feed(70);
    expect(s.cam.placement.value.steady).toBe(true);
    s.trackListener('mute')();
    s.feed(1);
    expect(s.cam.phase.value).toBe('placing');
    expect(s.cam.placement.value.steady).toBe(false);
    s.feed(70);
    s.cam.begin();
    expect(s.cam.phase.value).toBe('capturing');
    s.trackListener('mute')();
    expect(s.cam.phase.value).toBe('error');
    expect(s.cam.error.value).toBe('interrupted');
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('interrupts when the track ends while placing', async () => {
    const s = setup(FLAT);
    await s.cam.open();
    s.trackListener('ended')();
    expect(s.cam.phase.value).toBe('error');
    expect(s.cam.error.value).toBe('interrupted');
    expect(s.track.stop).toHaveBeenCalledOnce();
  });

  it('tears down and shows failed when the evaluation throws (rethrown in dev)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(estimate).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const s = setup();
    await openAndPlace(s);
    expect(() => s.feed(915)).toThrow('boom');
    expect(s.cam.phase.value).toBe('error');
    expect(s.cam.error.value).toBe('failed');
    expect(s.cam.verdict.value).toBeNull();
    expect(s.track.stop).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith('Camera evaluation failed', expect.any(Error));
  }, 15_000);

  it('does not start before the placement is steady', async () => {
    const s = setup(FLAT);
    await s.cam.open();
    s.feed(10);
    expect(s.cam.placement.value.steady).toBe(false);
    s.cam.begin();
    expect(s.cam.phase.value).toBe('placing');
  });

  it('is steady after two seconds of still, lit frames, not before', async () => {
    const s = setup(FLAT);
    await s.cam.open();
    s.feed(60); // the 60th frame lands 1969 ms after the first
    expect(s.cam.placement.value.steady).toBe(false);
    s.feed(1); // 2002 ms
    expect(s.cam.placement.value.steady).toBe(true);
  });

  it('reports a dark picture and a moving phone while placing', async () => {
    const dark = setup(DARK);
    await dark.cam.open();
    dark.feed(70);
    expect(dark.cam.placement.value).toMatchObject({ tooDark: true, steady: false });
    scope.stop();

    const shaky = setup({ ...SCENE, seconds: 4, shakeRmsPx: 3 });
    await shaky.cam.open();
    shaky.feed(70);
    expect(shaky.cam.placement.value).toMatchObject({ moving: true, steady: false });
  });

  it('releases the screen lock and the track listeners when the count ends', async () => {
    const lock = { released: false, release: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator), {
        wakeLock: { request: vi.fn().mockResolvedValue(lock) },
      }),
    );
    const s = setup(FLAT);
    await openAndPlace(s);
    await flushPromises();
    expect(lock.release).not.toHaveBeenCalled();
    s.feed(465, 1000 / 15); // 15 fps: done with frame-rate at 30 s
    expect(s.cam.phase.value).toBe('done');
    expect(lock.release).toHaveBeenCalledOnce();
    expect(s.track.removeEventListener.mock.calls.map(([name]) => name).sort()).toEqual([
      'ended',
      'mute',
    ]);
  });

  it('reports a refused screen lock while capturing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator), {
        wakeLock: { request: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) },
      }),
    );
    const s = setup(FLAT);
    await openAndPlace(s);
    expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen');
    await flushPromises();
    expect(s.cam.screenLockRefused.value).toBe(true);
  });
});
