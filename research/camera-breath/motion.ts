// Motion extractors: how much the chest ROI moves from frame to frame, with the camera's own
// motion taken out. Pure module: ES2020 only, no Node built-ins. This file holds the shared
// types and the 1-D profile cross-correlation extractor (the cross-check); Lucas-Kanade follows.

import { bandpass, parabolicOffset, rms } from './signal.ts';

/** One 8-bit grey frame, row-major. */
export interface Frame {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A rectangle in frame pixels. */
export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What an extractor learned about its own footing; estimate() turns these into reasons. */
export interface MotionQuality {
  borderRms?: number; // band-passed rms of the background motion, px: camera shake
  validTrackRatio?: number; // valid / total tracked points
  amplitudePx?: number; // band-passed rms of the signal itself, px
}

/** An extractor's output. The signal is UNFILTERED: estimate() detrends and band-passes it. */
export interface MotionSignal {
  signal: Float64Array;
  quality: MotionQuality;
}

/** Zero mean, unit standard deviation; a constant profile (std 0) becomes all zeros. */
function standardise(v: Float64Array): Float64Array {
  let m = 0;
  for (const x of v) m += x;
  m /= v.length;
  let s = 0;
  for (const x of v) s += (x - m) ** 2;
  s = Math.sqrt(s / v.length);
  const out = new Float64Array(v.length);
  if (s === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = (v[i] - m) / s;
  return out;
}

/** Mean grey level of each ROI row, standardised: the vertical texture the chest edge drags. */
export function rowProfile(frame: Frame, roi: Roi): Float64Array {
  const out = new Float64Array(roi.h);
  for (let y = 0; y < roi.h; y++) {
    const start = (roi.y + y) * frame.width + roi.x;
    let sum = 0;
    for (let x = 0; x < roi.w; x++) sum += frame.data[start + x];
    out[y] = sum / roi.w;
  }
  return standardise(out);
}

/** Mean grey level of each ROI column, standardised. */
export function colProfile(frame: Frame, roi: Roi): Float64Array {
  const out = new Float64Array(roi.w);
  for (let x = 0; x < roi.w; x++) {
    let sum = 0;
    for (let y = 0; y < roi.h; y++) sum += frame.data[(roi.y + y) * frame.width + roi.x + x];
    out[x] = sum / roi.h;
  }
  return standardise(out);
}

/**
 * Sub-sample shift of `cur` relative to `ref` by normalised cross-correlation over lags
 * −maxLag…maxLag, refined with a parabola through the best lag and its neighbours. A positive
 * shift means the content moved towards higher indices. `score` is the correlation at the peak.
 */
export function profileShift(
  ref: Float64Array,
  cur: Float64Array,
  maxLag = 8,
): { shift: number; score: number } {
  const n = ref.length;
  const r = new Float64Array(2 * maxLag + 1);
  for (let k = -maxLag; k <= maxLag; k++) {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, -k); i < Math.min(n, n - k); i++) {
      sum += ref[i] * cur[i + k];
      count++;
    }
    r[k + maxLag] = count === 0 ? 0 : sum / count;
  }
  let best = 0;
  for (let j = 1; j < r.length; j++) if (r[j] > r[best]) best = j;
  const offset =
    best > 0 && best < r.length - 1 ? parabolicOffset(r[best - 1], r[best], r[best + 1]) : 0;
  return { shift: best - maxLag + offset, score: r[best] };
}

/** The default background strip: the top rows of the frame, which must show static scene only. */
export function topStrip(size: Pick<Frame, 'width' | 'height'>, rows = 40): Roi {
  return { x: 0, y: 0, w: size.width, h: Math.min(rows, size.height) };
}

/**
 * Vertical ROI motion by row-profile cross-correlation against a reference frame that is
 * re-anchored every `reanchorS` seconds (carrying the accumulated offset), minus the same
 * measurement on a background strip so that camera shake cancels. The background defaults to
 * topStrip(frame); null disables it.
 */
export function profileMotion(
  frames: Iterable<Frame>,
  roi: Roi,
  fps: number,
  opts: { background?: Roi | null; reanchorS?: number } = {},
): MotionSignal {
  const reanchorEvery = Math.round((opts.reanchorS ?? 2) * fps);
  const roiShift: number[] = [];
  const bgShift: number[] = [];
  let background: Roi | null = null;
  let ref: Float64Array | null = null;
  let refBg: Float64Array | null = null;
  let offset = 0;
  let offsetBg = 0;
  let i = 0;
  for (const frame of frames) {
    if (ref === null) {
      background = opts.background === undefined ? topStrip(frame) : opts.background;
    }
    const cur = rowProfile(frame, roi);
    const curBg = background === null ? null : rowProfile(frame, background);
    if (ref === null) ref = cur;
    if (refBg === null) refBg = curBg;
    roiShift.push(offset + profileShift(ref, cur).shift);
    bgShift.push(
      curBg === null || refBg === null ? 0 : offsetBg + profileShift(refBg, curBg).shift,
    );
    i++;
    if (reanchorEvery > 0 && i % reanchorEvery === 0) {
      offset = roiShift[roiShift.length - 1];
      offsetBg = bgShift[bgShift.length - 1];
      ref = cur;
      refBg = curBg;
    }
  }
  const n = roiShift.length;
  const signal = new Float64Array(n);
  for (let j = 0; j < n; j++) signal[j] = roiShift[j] - bgShift[j];
  const bg = Float64Array.from(bgShift);
  // Clips shorter than eight samples cannot be band-passed; nothing downstream accepts them.
  const inBand = (v: Float64Array) => (v.length < 8 ? v : bandpass(v, fps));
  return {
    signal,
    quality: {
      borderRms: background === null || n < 8 ? 0 : rms(inBand(bg)),
      amplitudePx: rms(inBand(signal)),
    },
  };
}
