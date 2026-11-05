import { onScopeDispose, readonly, ref, type Ref } from 'vue';
import {
  CAMERA_CONSTRAINTS,
  cameraErrorKind,
  createFrameReader,
  videoFrames,
  type FrameSource,
} from '../camera/browser';
import {
  CAPTURE_FPS,
  PLACEMENT,
  defaultRoi,
  frameRateReason,
  frameTiming,
  gridSamples,
  nearCeiling,
  placementSample,
  resampleRow,
  slowDelivery,
  type CameraSeconds,
  type CaptureReason,
} from '../camera/capture';
import { estimate, type EstimateResult } from '../camera/estimate';
import { createLkTracker, frameMean, type Frame, type LkTracker } from '../camera/motion';
import type { Pet } from '../types';
import { DEFAULT_ELEVATED_CEILING, DEFAULT_NORMAL_CEILING } from '../utils/rateStatus';
import { isCameraSupported } from './useCameraOptIn';
import { useWakeLock } from './useWakeLock';

export type CameraPhase = 'idle' | 'requesting' | 'placing' | 'capturing' | 'done' | 'error';
export type CameraError =
  'denied' | 'no-camera' | 'busy' | 'unsupported' | 'failed' | 'interrupted';

export interface CameraVerdict {
  seconds: CameraSeconds;
  accepted: boolean;
  rate: number | null; // estimate.quantisedBpm when accepted
  interval: [number, number] | null;
  reasons: CaptureReason[]; // [] when accepted; ['frame-rate'] skips estimate()
  estimate: EstimateResult | null;
  deliveredFps: number | null;
}

/** What CameraCapture hands the tracker: a suggestion, plus the owner's own taps (3 or more). */
export interface CameraResult {
  rate: number;
  seconds: CameraSeconds;
  interval: [number, number];
  taps: number | null;
}

/** Injectable for tests: happy-dom has neither getUserMedia nor a canvas. */
export interface CameraBreathDeps {
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  frameSource?: FrameSource;
  readFrame?: (video: HTMLVideoElement) => Frame;
}

export interface CameraBreathOptions {
  pet: Ref<Pick<Pet, 'normalCeiling' | 'elevatedCeiling'> | undefined>;
  video: Ref<HTMLVideoElement | null>;
  deps?: CameraBreathDeps;
}

const HINT_EVERY_FRAMES = 30;
// The window is measured on the frame timeline (first captured frame to last), so a late first
// frame cannot shorten it; the wall clock only catches a camera that stopped delivering.
const STALL_MS = 3000;
// A camera that opens but never delivers a frame would leave the spinner up for good.
const PLAY_TIMEOUT_MS = 10_000;

/**
 * The camera breath count: owns the stream, the preview video, the frame reader, the tracker
 * and the timers. Frames never leave memory. Every exit from placing/capturing runs teardown(),
 * which stops the tracks; cancel() also runs when the owning component goes away.
 */
export function useCameraBreath(opts: CameraBreathOptions) {
  const deps = opts.deps ?? {};
  const wakeLock = useWakeLock();
  const phase = ref<CameraPhase>('idle');
  const error = ref<CameraError | null>(null);
  const placement = ref({ tooDark: false, moving: false, slow: false, steady: false });
  const hints = ref({ shake: false, fewTracks: false, tooDark: false });
  const elapsedSeconds = ref(0);
  const targetSeconds = ref<CameraSeconds>(30);
  const extending = ref(false);
  const verdict = ref<CameraVerdict | null>(null);

  let stream: MediaStream | null = null;
  let stopFrames: (() => void) | null = null;
  let readFrame: ((video: HTMLVideoElement) => Frame) | null = null;
  let tracker: LkTracker | null = null;
  let times: number[] = [];
  let startedAt = 0;
  let evaluated30 = false;
  // The last frame before the 30 s evaluation blocked the main thread; the gap after it is
  // the evaluation's own doing and is forgiven at 60 s (frameTiming).
  let evaluatedAfterMs: number | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let pendingEvaluate: ReturnType<typeof setTimeout> | null = null;
  let playTimer: ReturnType<typeof setTimeout> | null = null;
  let prevFrame: Frame | null = null;
  let anchor: Frame | null = null;
  let placingFrames = 0;
  let steadySince: number | null = null;
  // The placing frames' timestamps, the last PLACEMENT.rateWindowMs of them (plus the one that
  // makes the span reach it), to catch a camera that slowed down in dim light before Start.
  let rateWindow: number[] = [];
  // Bumped by every teardown; an await that comes back to an older session stands down.
  let session = 0;
  // window.innerWidth when the listeners went on: a rotation changes it, a URL bar does not.
  let widthAtStart = 0;

  function ceilings(): number[] {
    const pet = opts.pet.value;
    return [
      pet?.normalCeiling ?? DEFAULT_NORMAL_CEILING,
      pet?.elevatedCeiling ?? DEFAULT_ELEVATED_CEILING,
    ];
  }

  // A function, not an inline read: TypeScript would keep the first check's narrowing across the awaits.
  const pageHidden = () => document.visibilityState === 'hidden';

  function onVisibility() {
    if (pageHidden()) abort('interrupted');
  }
  function onResize() {
    // Chrome for Android fires resize when the URL bar collapses (height only); only a width
    // change (a rotation) moves the box the owner framed.
    if (window.innerWidth === widthAtStart) return;
    if (phase.value === 'capturing') abort('interrupted');
    else framingChanged();
  }
  function onOrientation() {
    if (phase.value === 'capturing') abort('interrupted');
    else framingChanged();
  }
  // A rotation while placing: the owner frames again, and the count that follows is compared
  // against the width it starts with, not the one the camera opened with.
  function framingChanged() {
    steadySince = null;
    rateWindow = [];
    widthAtStart = window.innerWidth;
  }
  function onTrackEnded() {
    abort('interrupted');
  }
  function onTrackMute() {
    // Some devices mute briefly right after the stream starts; only a mute mid-count interrupts.
    if (phase.value === 'capturing') abort('interrupted');
    else {
      steadySince = null;
      rateWindow = [];
    }
  }

  function listen(on: boolean) {
    const m = on ? 'addEventListener' : 'removeEventListener';
    document[m]('visibilitychange', onVisibility);
    window[m]('resize', onResize);
    window[m]('orientationchange', onOrientation);
    for (const track of stream?.getTracks() ?? []) {
      track[m]('ended', onTrackEnded);
      track[m]('mute', onTrackMute);
    }
  }

  async function open(): Promise<void> {
    if (phase.value !== 'idle' && phase.value !== 'error' && phase.value !== 'done') return;
    error.value = null;
    verdict.value = null;
    const getUserMedia =
      deps.getUserMedia ??
      (isCameraSupported()
        ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)
        : null);
    if (!getUserMedia) {
      phase.value = 'error';
      error.value = 'unsupported';
      return;
    }
    const mine = ++session;
    phase.value = 'requesting';
    let granted: MediaStream;
    try {
      granted = await getUserMedia(CAMERA_CONSTRAINTS);
    } catch (e) {
      if (mine !== session) return; // cancelled while the prompt was open
      phase.value = 'error';
      error.value = cameraErrorKind(e);
      return;
    }
    if (mine !== session) {
      // Cancelled (or opened again) while the prompt was open: never leave a track running.
      for (const track of granted.getTracks()) track.stop();
      return;
    }
    if (pageHidden()) {
      // Granted after the owner left (Home while the prompt was up): never start the camera unseen.
      for (const track of granted.getTracks()) track.stop();
      phase.value = 'error';
      error.value = 'interrupted';
      return;
    }
    stream = granted;
    const video = opts.video.value;
    playTimer = setTimeout(() => {
      playTimer = null;
      teardown();
      phase.value = 'error';
      error.value = 'busy';
    }, PLAY_TIMEOUT_MS);
    try {
      if (!video) throw new Error('No preview element');
      readFrame = deps.readFrame ?? createFrameReader();
      video.srcObject = stream;
      await video.play();
      if (mine !== session) return; // torn down while play() was pending; the tracks are stopped
    } catch (e) {
      if (mine !== session) return; // the teardown itself rejects a pending play()
      console.warn('Camera preview failed', e);
      teardown();
      phase.value = 'error';
      error.value = 'failed';
      return;
    } finally {
      // A teardown meanwhile (cancel, the timer itself) has cleared it and may own a newer one.
      if (mine === session && playTimer !== null) {
        clearTimeout(playTimer);
        playTimer = null;
      }
    }
    if (pageHidden()) {
      teardown();
      phase.value = 'error';
      error.value = 'interrupted';
      return;
    }
    prevFrame = null;
    anchor = null;
    placingFrames = 0;
    steadySince = null;
    rateWindow = [];
    placement.value = { tooDark: false, moving: false, slow: false, steady: false };
    widthAtStart = window.innerWidth;
    listen(true);
    stopFrames = (deps.frameSource ?? videoFrames)(video, onFrame);
    phase.value = 'placing';
  }

  function onFrame(timeMs: number) {
    const video = opts.video.value;
    if (!video || !readFrame) return;
    if (phase.value === 'placing') {
      const frame = readFrame(video);
      if (placingFrames++ % PLACEMENT.anchorFrames === 0) anchor = frame;
      const s = placementSample(anchor, frame, defaultRoi(frame).background);
      // One line per placement, to tune minLuma and the box on a device.
      if (import.meta.env.DEV && placingFrames === 1) console.debug('camera placement', s);
      prevFrame = frame;
      const tooDark = s.luma < PLACEMENT.minLuma;
      const moving = s.flowPx !== null && s.flowPx > PLACEMENT.maxFlowPx;
      rateWindow.push(timeMs);
      while (rateWindow.length > 2 && timeMs - rateWindow[1] >= PLACEMENT.rateWindowMs) {
        rateWindow.shift();
      }
      let timing = frameTiming(rateWindow);
      // Once slow, the window holds only the frames since the rate last fell short, so the hint
      // clears after a whole window at the full rate, not as soon as the average crosses 28:
      // a rate hovering around the threshold cannot make it flicker.
      if (placement.value.slow && slowDelivery(timing)) {
        rateWindow = [timeMs];
        timing = frameTiming(rateWindow);
      }
      // Under 2 s of frames is too few to judge; the last verdict stands meanwhile.
      const judged = timing.spanMs >= PLACEMENT.rateWindowMs;
      const slow = judged ? slowDelivery(timing) : placement.value.slow;
      let steady = false;
      if (tooDark || moving) steadySince = null;
      else {
        steadySince ??= Date.now();
        steady = judged && !slow && Date.now() - steadySince >= PLACEMENT.steadyMs;
      }
      placement.value = { tooDark, moving, slow, steady };
    } else if (phase.value === 'capturing' && tracker) {
      const frame = readFrame(video);
      tracker.push(frame);
      times.push(timeMs);
      if (tracker.count % HINT_EVERY_FRAMES === 0) {
        const latest = tracker.latest!;
        hints.value = {
          shake: latest.backgroundFlowPx > PLACEMENT.maxFlowPx,
          fewTracks: latest.validRatio < 0.6,
          tooDark: frameMean(frame) < PLACEMENT.minLuma,
        };
      }
    }
  }

  function begin(): void {
    if (phase.value !== 'placing' || !placement.value.steady || !prevFrame) return;
    const { roi, background } = defaultRoi(prevFrame);
    tracker = createLkTracker(roi, CAPTURE_FPS, { background });
    times = [];
    startedAt = Date.now();
    evaluated30 = false;
    evaluatedAfterMs = null;
    elapsedSeconds.value = 0;
    targetSeconds.value = 30;
    extending.value = false;
    hints.value = { shake: false, fewTracks: false, tooDark: false };
    wakeLock.acquire();
    phase.value = 'capturing';
    // Clock-timed like TrackerView: timers are throttled in the background.
    interval = setInterval(tick, 250);
  }

  function tick(): void {
    elapsedSeconds.value = Math.min(
      targetSeconds.value,
      Math.floor((Date.now() - startedAt) / 1000),
    );
    const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
    if (!evaluated30 && span >= 30_000) {
      evaluated30 = true;
      schedule(30);
    } else if (targetSeconds.value === 60 && span >= 60_000) {
      schedule(60);
    } else if (Date.now() - startedAt > targetSeconds.value * 1000 + STALL_MS) {
      verdict.value = {
        seconds: targetSeconds.value,
        accepted: false,
        rate: null,
        interval: null,
        reasons: ['frame-rate'],
        estimate: null,
        deliveredFps: frameTiming(times).fps,
      };
      finish();
    }
  }

  // Off the tick and the frame callback: a few ms of PCA must not delay either.
  function schedule(seconds: CameraSeconds): void {
    if (pendingEvaluate !== null) return;
    pendingEvaluate = setTimeout(() => {
      pendingEvaluate = null;
      if (phase.value !== 'capturing' || !tracker) return;
      try {
        evaluate(seconds, tracker);
      } catch (e) {
        // A bug in the estimator path (e.g. an off-grid window) must not leave the camera on.
        console.error('Camera evaluation failed', e);
        teardown();
        verdict.value = null;
        phase.value = 'error';
        error.value = 'failed';
        if (import.meta.env.DEV) throw e;
      }
    }, 0);
  }

  function evaluate(seconds: CameraSeconds, lk: LkTracker): void {
    const startedMs = performance.now();
    const lastFrameMs = times[times.length - 1];
    const timing = frameTiming(times, evaluatedAfterMs ?? undefined);
    const frameRate = frameRateReason(timing, seconds);
    if (frameRate) {
      // Continuing cannot repair a gap or low light: end now.
      verdict.value = {
        seconds,
        accepted: false,
        rate: null,
        interval: null,
        reasons: [frameRate],
        estimate: null,
        deliveredFps: timing.fps,
      };
      finish();
      return;
    }
    const res = lk.result((row) => resampleRow(row, times, gridSamples(seconds)));
    const est = estimate(res.signal, CAPTURE_FPS, res.quality);
    const accepted = est.reasons.length === 0;
    // How long the evaluation held the main thread, to read on a device against the 100 ms gap.
    if (import.meta.env.DEV) {
      console.debug('camera evaluation', { seconds, ms: performance.now() - startedMs });
    }
    if (accepted && (est.quantisedBpm === null || est.interval === null)) {
      throw new Error('Camera window is off the grid');
    }
    const rate = accepted ? est.quantisedBpm : null; // null exactly when the estimator abstained
    if (seconds === 30 && (rate === null || nearCeiling(rate, ceilings()))) {
      // An abstain may succeed with more signal; a reading near a ceiling needs the 60 s quantum.
      extending.value = true;
      targetSeconds.value = 60;
      evaluatedAfterMs = lastFrameMs;
      return;
    }
    verdict.value = {
      seconds,
      accepted,
      rate,
      interval: est.interval,
      reasons: est.reasons,
      estimate: est,
      deliveredFps: timing.fps,
    };
    finish();
  }

  function teardown(): void {
    session++;
    if (interval !== null) clearInterval(interval);
    interval = null;
    if (pendingEvaluate !== null) clearTimeout(pendingEvaluate);
    pendingEvaluate = null;
    if (playTimer !== null) clearTimeout(playTimer);
    playTimer = null;
    wakeLock.release();
    stopFrames?.();
    stopFrames = null;
    listen(false);
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    const video = opts.video.value;
    if (video) video.srcObject = null;
    tracker = null;
    prevFrame = null;
    times = [];
  }

  function finish(): void {
    teardown();
    phase.value = 'done';
  }

  function abort(kind: CameraError): void {
    if (phase.value !== 'placing' && phase.value !== 'capturing') return;
    teardown();
    verdict.value = null;
    phase.value = 'error';
    error.value = kind;
  }

  /** Stops everything and returns to idle; also runs when the component goes away. */
  function cancel(): void {
    teardown();
    phase.value = 'idle';
    error.value = null;
    verdict.value = null;
  }
  onScopeDispose(cancel);

  return {
    phase: readonly(phase),
    error: readonly(error),
    placement: readonly(placement),
    hints: readonly(hints),
    elapsedSeconds: readonly(elapsedSeconds),
    targetSeconds: readonly(targetSeconds),
    extending: readonly(extending),
    verdict: readonly(verdict),
    screenLockRefused: wakeLock.refused,
    open,
    begin,
    cancel,
  };
}
