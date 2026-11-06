// The frame grid between a real camera and the estimator. Pure module: ES2020 only, no DOM,
// no Node built-ins. A camera delivers 29.97 or variable frames per second and drops to 15 in
// dim light; estimate() quantises only on exact 900/1800-sample windows, so frames are
// timestamped, the delivered rate is measured, and the trajectories are put onto an exact
// 30 Hz grid or the capture abstains ('frame-rate').
//
// Relative imports in src/camera carry their .ts extension: the research CLI
// (research/camera-breath/run.ts) runs these files under plain Node type stripping, which has
// no extension search. research/camera-breath/run.test.ts spawns it to keep that true.

import type { AbstainReason } from './estimate.ts';
import {
  type Frame,
  type Roi,
  LK_DEFAULTS,
  backgroundPoints,
  frameMean,
  lkTrack,
  topStrip,
} from './motion.ts';
import { median } from './signal.ts';

/** The protocol frame rate (research README §6): below 28 fps a 25 Hz purr aliases into the band. */
export const CAPTURE_FPS = 30;
export const MIN_DELIVERED_FPS = 28;
/** A dropped-frame run longer than this cannot be interpolated honestly. */
export const MAX_GAP_MS = 100;
/** The app's working size; the gates were calibrated on 192×144 (research README §2). */
export const FRAME_WIDTH = 192;
export const FRAME_HEIGHT = 144;
/** Camera windows: 15 s is ±2 bpm by quantisation, so only these two. */
export type CameraSeconds = 30 | 60;
export const CAMERA_SECONDS: readonly CameraSeconds[] = [30, 60];
export type CaptureReason = AbstainReason | 'frame-rate';

export interface FrameTiming {
  count: number;
  spanMs: number; // last − first timestamp; 0 below 2 frames
  fps: number | null; // (count − 1) / span; null below 2 frames
  maxGapMs: number; // largest consecutive difference; 0 below 2 frames
}

/**
 * The delivered rate, the span and the largest gap of `timesMs`. With `exemptGapAfterMs`, the
 * one gap that starts at the first frame with that timestamp is left out of `maxGapMs`: the
 * 30 s evaluation blocks the main thread for up to ~100 ms on a slow WebView and
 * requestVideoFrameCallback coalesces the frames presented meanwhile into one late callback,
 * so the resampler interpolates across that single known hold, the honest error to accept
 * rather than ending every extended count with 'frame-rate'. Every other gap counts, and
 * `fps` and `spanMs` still see every frame.
 */
export function frameTiming(timesMs: ArrayLike<number>, exemptGapAfterMs?: number): FrameTiming {
  const count = timesMs.length;
  if (count < 2) return { count, spanMs: 0, fps: null, maxGapMs: 0 };
  let exemptAt = -1;
  if (exemptGapAfterMs !== undefined) {
    for (let i = 0; i < count - 1; i++) {
      if (timesMs[i] === exemptGapAfterMs) {
        exemptAt = i;
        break;
      }
    }
  }
  let maxGapMs = 0;
  for (let i = 1; i < count; i++) {
    if (i - 1 === exemptAt) continue;
    maxGapMs = Math.max(maxGapMs, timesMs[i] - timesMs[i - 1]);
  }
  const spanMs = timesMs[count - 1] - timesMs[0];
  return { count, spanMs, fps: spanMs > 0 ? ((count - 1) * 1000) / spanMs : null, maxGapMs };
}

/** 'frame-rate' when the delivered frames cannot be put onto the 30 Hz grid honestly. */
export function frameRateReason(t: FrameTiming, seconds: CameraSeconds): 'frame-rate' | null {
  if (t.fps === null || t.fps < MIN_DELIVERED_FPS || t.maxGapMs > MAX_GAP_MS) return 'frame-rate';
  // The frames must cover the window: two frame periods of slack for the last callback.
  if (t.spanMs < seconds * 1000 - 2 * (1000 / CAPTURE_FPS)) return 'frame-rate';
  return null;
}

/** seconds × CAPTURE_FPS: 900 or 1800, the exact window estimate() quantises on. */
export function gridSamples(seconds: CameraSeconds): number {
  return seconds * CAPTURE_FPS;
}

/**
 * Linear interpolation of `row` (one value per frame at `timesMs`) onto `samples` points spaced
 * 1000/fps ms from timesMs[0]. Holds the last value past the end (never extrapolates). Throws
 * when row and timesMs differ in length or are empty.
 */
export function resampleRow(
  row: ArrayLike<number>,
  timesMs: ArrayLike<number>,
  samples: number,
  fps = CAPTURE_FPS,
): Float64Array {
  const n = row.length;
  if (n === 0 || n !== timesMs.length) {
    throw new Error(`resampleRow: ${n} values for ${timesMs.length} timestamps`);
  }
  const out = new Float64Array(samples);
  const step = 1000 / fps;
  let j = 0; // timesMs[j] <= t < timesMs[j + 1]
  for (let i = 0; i < samples; i++) {
    const t = timesMs[0] + i * step;
    while (j + 1 < n && timesMs[j + 1] <= t) j++;
    if (j + 1 >= n) {
      out[i] = row[n - 1];
      continue;
    }
    // timesMs[j] <= t < timesMs[j + 1], so the span is positive.
    const f = (t - timesMs[j]) / (timesMs[j + 1] - timesMs[j]);
    out[i] = row[j] + f * (row[j + 1] - row[j]);
  }
  return out;
}

/** Whether an accepted 30 s reading sits within 1 bpm of any of the pet's ceilings (README §9). */
export function nearCeiling(bpm: number, ceilings: readonly number[]): boolean {
  return ceilings.some((c) => Math.abs(bpm - c) <= 1);
}

/** 8-bit grey from RGBA (BT.601 integer weights), the Frame the tracker reads. */
export function greyFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Frame {
  const n = width * height;
  if (rgba.length !== n * 4) throw new Error(`greyFromRgba: ${rgba.length} bytes for ${n} pixels`);
  const data = new Uint8Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    data[i] = (77 * rgba[o] + 150 * rgba[o + 1] + 29 * rgba[o + 2] + 128) >> 8;
  }
  return { width, height, data };
}

/**
 * The centred region of a vw×vh video frame with the aspect of width×height: the part
 * `object-fit: cover` shows in a width:height box, so the reader and the preview crop alike.
 * A frame without metadata yet (0×0) crops nothing.
 */
export function coverCrop(
  vw: number,
  vh: number,
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (vw <= 0 || vh <= 0) return { sx: 0, sy: 0, sw: vw, sh: vh };
  let sw = vw;
  let sh = vh;
  if (vw * height > vh * width)
    sw = Math.round((vh * width) / height); // wider: trim the sides
  else sh = Math.round((vw * height) / width); // taller: trim top and bottom
  return { sx: Math.floor((vw - sw) / 2), sy: Math.floor((vh - sh) / 2), sw, sh };
}

/**
 * The fixed box the owner frames the chest in (60 % of the width, 50 % of the height) and the
 * background strip above it (the top 40 rows at 192×144, scaled with the frame, as the
 * synthetic scenes do). The box starts where the strip ends, so the strip stays clear of the
 * body when the owner follows the instruction. 116×72 at 38,40 for 192×144.
 */
export function defaultRoi(size: Pick<Frame, 'width' | 'height'>): { roi: Roi; background: Roi } {
  const background = topStrip(size, Math.round((size.height * 40) / 144));
  const w = 2 * Math.round(size.width * 0.3); // even, so the box is centred on whole pixels
  const h = 2 * Math.round(size.height * 0.25);
  return { roi: { x: (size.width - w) / 2, y: background.h, w, h }, background };
}

/**
 * Pre-capture placement gates; hints only, the capture-time gates are the verdict.
 * minLuma is device-tuned (auto-exposure decides the mean level a dim room gets; the synthetic
 * scenes the gates were calibrated on average 125). maxFlowPx is the median background flow
 * against an anchor frame renewed every anchorFrames: on synthetic scenes (seed 3, 4 s) a
 * propped phone stays below 0.34 px, 0.5 px rms hand shake has a median of 0.48 and 1 px of
 * 0.98; frame-to-frame flow cannot tell them apart (0.14 vs 0.18). rateWindowMs is the span of
 * frames the delivered rate is judged on (slowDelivery).
 */
export const PLACEMENT = {
  minLuma: 40,
  maxFlowPx: 0.5,
  anchorFrames: 30,
  steadyMs: 2000,
  rateWindowMs: 2000,
} as const;

/**
 * Whether frames come too slowly for a count: the capture-time gates (MIN_DELIVERED_FPS,
 * MAX_GAP_MS) applied while placing, because a phone camera lowers its frame rate in dim light
 * and the count would end with 'frame-rate'. False below 2 frames; the caller decides how long
 * a span is enough to judge.
 */
export function slowDelivery(t: FrameTiming): boolean {
  return t.fps !== null && (t.fps < MIN_DELIVERED_FPS || t.maxGapMs > MAX_GAP_MS);
}

export interface PlacementSample {
  luma: number;
  flowPx: number | null; // null without an anchor or when nothing in the strip tracks
}

/** Mean luma of `frame` and the median background flow from `anchor` to `frame` (null without an anchor). */
export function placementSample(
  prev: Frame | null,
  frame: Frame,
  background: Roi,
): PlacementSample {
  const luma = frameMean(frame);
  if (prev === null) return { luma, flowPx: null };
  const points = backgroundPoints(background, LK_DEFAULTS.half);
  const ok = lkTrack(prev, frame, points, LK_DEFAULTS).filter((t) => t.ok);
  const flowPx = ok.length === 0 ? null : median(ok.map((t) => Math.hypot(t.dx, t.dy)));
  return { luma, flowPx };
}
