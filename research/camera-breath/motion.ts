// Motion extractors: how much the chest ROI moves from frame to frame, with the camera's own
// motion taken out. Pure module: ES2020 only, no Node built-ins. This file holds the shared
// types, the 1-D profile cross-correlation extractor (the cross-check) and the sparse
// Lucas-Kanade grid with per-point PCA (the primary extractor).

import { bandpass, linearDetrend, median, parabolicOffset, rms } from './signal.ts';

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

// ------------------------------------------------------------------ Lucas-Kanade

export interface LkOptions {
  grid?: number; // grid × grid tracked points spread over the ROI
  half?: number; // half the window side: (2·half + 1)² pixels per point
  levels?: number; // 2: a coarse pass on the half-size frame seeds the full-size one
  iterations?: number; // Gauss–Newton steps per level
  minEigen?: number; // smaller eigenvalue of the gradient matrix below which a window is untextured
  maxResidual?: number; // mean |It| above which a match is rejected (occlusion guard, uncalibrated)
  reanchorS?: number; // seconds between reference-frame renewals
  background?: Roi | null; // undefined → topStrip(frame); null disables the subtraction
}

/** What lkTrack needs: the per-point options, all present. */
export type LkTrackOptions = Required<
  Pick<LkOptions, 'half' | 'levels' | 'iterations' | 'minEigen' | 'maxResidual'>
>;

/**
 * Defaults the gates were calibrated with. minEigen 300 separates a σ = 4 noise patch (λmin ≈ 184
 * after the blur) from texture at contrast 20 (≈ 3962); maxResidual never fires on synthetic
 * scenes (their residual is the noise floor, 3.7–4.8) and is uncalibrated on real fur.
 */
export const LK_DEFAULTS: Required<Omit<LkOptions, 'background'>> & {
  background: Roi | null | undefined;
} = {
  grid: 5,
  half: 7,
  levels: 2,
  iterations: 5,
  minEigen: 300,
  maxResidual: 10,
  reanchorS: 2,
  background: undefined,
};

/** 3×3 binomial blur (1 2 1 / 2 4 2 / 1 2 1)/16; the border rows and columns are 0. */
export function blur3(f: Frame): Frame {
  const { width: W, height: H, data: d } = f;
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const o = y * W + x;
      out[o] =
        (4 * d[o] +
          2 * (d[o - 1] + d[o + 1] + d[o - W] + d[o + W]) +
          d[o - W - 1] +
          d[o - W + 1] +
          d[o + W - 1] +
          d[o + W + 1] +
          8) >>
        4;
    }
  }
  return { width: W, height: H, data: out };
}

/** Half-size frame by 2×2 box averaging, rounded. */
export function downsample2(f: Frame): Frame {
  const W = f.width >> 1;
  const H = f.height >> 1;
  const out = new Uint8Array(W * H);
  const d = f.data;
  const w = f.width;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = 2 * y * w + 2 * x;
      out[y * W + x] = (d[o] + d[o + 1] + d[o + w] + d[o + w + 1] + 2) >> 2;
    }
  }
  return { width: W, height: H, data: out };
}

export function frameMean(f: Frame): number {
  let sum = 0;
  for (const v of f.data) sum += v;
  return sum / f.data.length;
}

export interface LkMatch {
  dx: number;
  dy: number;
  lmin: number; // smaller eigenvalue of the gradient matrix: how trackable the window is
  resid: number; // mean |It| of the last pass
  ok: boolean; // false when the window left either frame
}

/**
 * One Lucas-Kanade point: the (dx, dy) that moves the (2·half + 1)² window around (px, py) in
 * `ref` onto `cur`, by Gauss–Newton from (dx0, dy0). `cur` is multiplied by `gain` first so a
 * whole-frame brightness change (flicker, auto-exposure) is not read as motion.
 */
export function lkPoint(
  ref: Frame,
  cur: Frame,
  px: number,
  py: number,
  half: number,
  iterations: number,
  dx0: number,
  dy0: number,
  gain: number,
): LkMatch {
  const W = ref.width;
  const H = ref.height;
  const R = ref.data;
  const C = cur.data;
  const n = (2 * half + 1) ** 2;
  if (px - half - 1 < 0 || py - half - 1 < 0 || px + half + 1 >= W || py + half + 1 >= H) {
    return { dx: dx0, dy: dy0, lmin: 0, resid: 255, ok: false };
  }
  const ix = new Float32Array(n);
  const iy = new Float32Array(n);
  let gxx = 0;
  let gxy = 0;
  let gyy = 0;
  for (let j = -half, k = 0; j <= half; j++) {
    for (let i = -half; i <= half; i++, k++) {
      const o = (py + j) * W + px + i;
      ix[k] = (R[o + 1] - R[o - 1]) / 2;
      iy[k] = (R[o + W] - R[o - W]) / 2;
      gxx += ix[k] * ix[k];
      gxy += ix[k] * iy[k];
      gyy += iy[k] * iy[k];
    }
  }
  const tr = gxx + gyy;
  const det = gxx * gyy - gxy * gxy;
  const lmin = (tr - Math.sqrt(Math.max(0, tr * tr - 4 * det))) / 2;
  let dx = dx0;
  let dy = dy0;
  let resid = 0;
  for (let it = 0; it < iterations; it++) {
    let bx = 0;
    let by = 0;
    resid = 0;
    for (let j = -half, k = 0; j <= half; j++) {
      for (let i = -half; i <= half; i++, k++) {
        const x = px + i + dx;
        const y = py + j + dy;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) {
          return { dx, dy, lmin, resid: 255, ok: false };
        }
        const fx = x - x0;
        const fy = y - y0;
        const o = y0 * W + x0;
        const v =
          gain *
          ((C[o] * (1 - fx) + C[o + 1] * fx) * (1 - fy) +
            (C[o + W] * (1 - fx) + C[o + W + 1] * fx) * fy);
        const diff = v - R[(py + j) * W + px + i];
        bx += ix[k] * diff;
        by += iy[k] * diff;
        resid += Math.abs(diff);
      }
    }
    // A singular gradient matrix (flat window) has no step; lmin = 0 rejects it downstream.
    if (det === 0) break;
    const ddx = -(gyy * bx - gxy * by) / det;
    const ddy = -(-gxy * bx + gxx * by) / det;
    dx += ddx;
    dy += ddy;
    if (Math.abs(ddx) + Math.abs(ddy) < 0.01) break;
  }
  return { dx, dy, lmin, resid: resid / n, ok: true };
}

/** grid × grid points spread evenly inside the ROI, row by row. */
export function gridPoints(roi: Roi, grid: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let j = 1; j <= grid; j++) {
    for (let i = 1; i <= grid; i++) {
      out.push([
        Math.round(roi.x + (roi.w * i) / (grid + 1)),
        Math.round(roi.y + (roi.h * j) / (grid + 1)),
      ]);
    }
  }
  return out;
}

/** Points along the top and bottom of the background strip, every 24 px, clear of its edges. */
export function backgroundPoints(bg: Roi, half: number): Array<[number, number]> {
  const ys = [bg.y + half + 2, bg.y + bg.h - half - 2].filter(
    (y, i, all) => all.indexOf(y) === i && y >= bg.y,
  );
  const out: Array<[number, number]> = [];
  for (let x = bg.x + half + 2; x < bg.x + bg.w - half - 2; x += 24) {
    for (const y of ys) out.push([x, y]);
  }
  return out;
}

function trackBlurred(
  refB: Frame,
  curB: Frame,
  points: ReadonlyArray<readonly [number, number]>,
  o: LkTrackOptions,
): LkMatch[] {
  const curMean = frameMean(curB);
  const gain = curMean > 0 ? frameMean(refB) / curMean : 1;
  const refS = o.levels > 1 ? downsample2(refB) : null;
  const curS = o.levels > 1 ? downsample2(curB) : null;
  const maxShift = ((2 * o.half + 1) / 3) * (o.levels > 1 ? 2 : 1);
  return points.map(([px, py]) => {
    let dx = 0;
    let dy = 0;
    if (refS !== null && curS !== null) {
      const c = lkPoint(refS, curS, px >> 1, py >> 1, o.half >> 1, o.iterations, 0, 0, gain);
      dx = 2 * c.dx;
      dy = 2 * c.dy;
    }
    const f = lkPoint(refB, curB, px, py, o.half, o.iterations, dx, dy, gain);
    const ok =
      f.ok &&
      f.lmin >= o.minEigen &&
      f.resid <= o.maxResidual &&
      Math.hypot(f.dx, f.dy) <= maxShift;
    return { ...f, ok };
  });
}

/**
 * Tracks `points` from `ref` to `cur`: both frames are blurred (3×3 binomial), the brightness
 * gain between them is cancelled, and with levels > 1 a coarse pass on the half-size frames
 * seeds the full-size one. A match is `ok` only when its window stayed inside both frames,
 * had enough texture (lmin), matched (resid) and moved a plausible distance for the window.
 */
export function lkTrack(
  ref: Frame,
  cur: Frame,
  points: ReadonlyArray<readonly [number, number]>,
  o: LkTrackOptions,
): LkMatch[] {
  return trackBlurred(blur3(ref), blur3(cur), points, o);
}

/**
 * First principal component of the rows (p × p covariance over n samples, 50 power
 * iterations). The sign is fixed by making the largest-magnitude weight positive, so the
 * combined signal is deterministic.
 */
export function pcaWeights(rows: ReadonlyArray<Float64Array>): Float64Array {
  const p = rows.length;
  const n = rows[0]?.length ?? 0;
  const cov = new Float64Array(p * p);
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += rows[a][j] * rows[b][j];
      cov[a * p + b] = cov[b * p + a] = n === 0 ? 0 : sum / n;
    }
  }
  let v = new Float64Array(p).fill(1 / Math.sqrt(p));
  for (let it = 0; it < 50; it++) {
    const w = new Float64Array(p);
    for (let a = 0; a < p; a++) {
      let sum = 0;
      for (let b = 0; b < p; b++) sum += cov[a * p + b] * v[b];
      w[a] = sum;
    }
    const norm = Math.hypot(...w) || 1;
    v = w.map((x) => x / norm);
  }
  let big = 0;
  for (let a = 1; a < p; a++) if (Math.abs(v[a]) > Math.abs(v[big])) big = a;
  if (v[big] < 0) v = v.map((x) => -x);
  return v;
}

/**
 * ROI motion from a grid of Lucas-Kanade points tracked against a reference frame that is
 * renewed every `reanchorS` seconds (carrying each point's accumulated offset), minus the
 * median flow of the background points so that camera shake cancels. The 2·grid² trajectories
 * (dy then dx) are combined by their first principal component, weighted on the band-passed
 * rows but applied to the unfiltered ones: the signal stays unfiltered for estimate().
 */
export function lkMotion(
  frames: Iterable<Frame>,
  roi: Roi,
  fps: number,
  opts: LkOptions = {},
): MotionSignal & { weights: Float64Array; perPoint: Float64Array[] } {
  const o = { ...LK_DEFAULTS, ...opts };
  const grid = gridPoints(roi, o.grid);
  const reanchorEvery = Math.round(o.reanchorS * fps);
  let anchor: Frame | null = null;
  let background: Roi | null = null;
  let bgPoints: Array<[number, number]> = [];
  const dy: number[][] = grid.map(() => []);
  const dx: number[][] = grid.map(() => []);
  const bgDy: number[] = [];
  const offX = new Float64Array(grid.length);
  const offY = new Float64Array(grid.length);
  const lastX = new Float64Array(grid.length); // last valid displacement since the anchor
  const lastY = new Float64Array(grid.length);
  let bgOffX = 0;
  let bgOffY = 0;
  let valid = 0;
  let total = 0;
  let i = 0;
  for (const frame of frames) {
    const cur = blur3(frame);
    if (anchor === null) {
      anchor = cur;
      background = o.background === undefined ? topStrip(frame) : o.background;
      bgPoints = background === null ? [] : backgroundPoints(background, o.half);
    }
    const tracks = trackBlurred(anchor, cur, [...grid, ...bgPoints], o);
    const okBg = tracks.slice(grid.length).filter((t) => t.ok);
    // No valid background point (black bars, a flat wall): nothing to subtract, flow 0.
    const flowX = okBg.length === 0 ? 0 : median(okBg.map((t) => t.dx))!;
    const flowY = okBg.length === 0 ? 0 : median(okBg.map((t) => t.dy))!;
    bgDy.push(bgOffY + flowY);
    for (let k = 0; k < grid.length; k++) {
      const t = tracks[k];
      total++;
      if (t.ok) {
        valid++;
        lastX[k] = t.dx;
        lastY[k] = t.dy;
        dx[k].push(offX[k] + t.dx - (bgOffX + flowX));
        dy[k].push(offY[k] + t.dy - (bgOffY + flowY));
      } else {
        // A lost point holds its last value rather than injecting a jump.
        dx[k].push(i === 0 ? 0 : dx[k][i - 1]);
        dy[k].push(i === 0 ? 0 : dy[k][i - 1]);
      }
    }
    i++;
    if (reanchorEvery > 0 && i % reanchorEvery === 0) {
      anchor = cur;
      for (let k = 0; k < grid.length; k++) {
        offX[k] += lastX[k];
        offY[k] += lastY[k];
      }
      lastX.fill(0);
      lastY.fill(0);
      bgOffX += flowX;
      bgOffY += flowY;
    }
  }
  const n = bgDy.length;
  if (n === 0) throw new Error('lkMotion: no frames');
  // Clips shorter than eight samples cannot be band-passed; nothing downstream accepts them.
  const inBand = (v: Float64Array) => (v.length < 8 ? v : bandpass(v, fps));
  const rowsY = dy.map((r) => Float64Array.from(r));
  const rowsX = dx.map((r) => Float64Array.from(r));
  const rows = [...rowsY, ...rowsX].map(linearDetrend);
  const weights = pcaWeights(rows.map(inBand));
  const signal = new Float64Array(n);
  for (let a = 0; a < rows.length; a++) {
    for (let j = 0; j < n; j++) signal[j] += weights[a] * rows[a][j];
  }
  return {
    signal,
    quality: {
      validTrackRatio: valid / total,
      borderRms: background === null || n < 8 ? 0 : rms(inBand(Float64Array.from(bgDy))),
      amplitudePx: median(rowsY.map((r) => rms(inBand(r)))) ?? 0,
    },
    weights,
    perPoint: rowsY,
  };
}
