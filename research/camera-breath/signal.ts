// Pure 1-D signal helpers for the camera-breath prototype. ES2020 only, no Node built-ins
// (the ESLint fence enforces it): if the method ever ships, this file moves into the app as is.

/** Arithmetic mean. NaN on an empty array; callers that can see one check the length first. */
export function mean(x: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  return sum / x.length;
}

/** Root mean square, i.e. the amplitude of a signal around zero. */
export function rms(x: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}

/** Population standard deviation (divides by n: these are whole signals, not samples). */
export function std(x: ArrayLike<number>): number {
  const m = mean(x);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += (x[i] - m) ** 2;
  return Math.sqrt(sum / x.length);
}

/** Median of the non-NaN values; null when none are left (an estimator with no input). */
export function median(x: ArrayLike<number>): number | null {
  const sorted = Array.from(x)
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const half = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

/** Median absolute deviation about the median: a spread estimate that ignores outliers. */
export function mad(x: ArrayLike<number>): number | null {
  const m = median(x);
  if (m === null) return null;
  return median(Array.from(x, (v) => Math.abs(v - m)));
}

/**
 * Removes the least-squares line through (i − (n − 1)/2, x[i]). Slow drift (the animal
 * settling, the phone creeping) would otherwise dominate the spectrum below the breathing band.
 */
export function linearDetrend(x: Float64Array): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const tMean = (n - 1) / 2;
  const xMean = mean(x);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - tMean) * (x[i] - xMean);
    sxx += (i - tMean) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  for (let i = 0; i < n; i++) out[i] = x[i] - xMean - slope * (i - tMean);
  return out;
}

/** One second-order IIR section, normalised so that a0 = 1. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Second-order Butterworth section from the RBJ cookbook (Q = 1/√2). The cookbook's sin/cos
 * form is already pre-warped, so the −3 dB point lands on `hz` exactly at any sample rate.
 */
export function biquad(type: 'lowpass' | 'highpass', hz: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * hz) / fs;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = type === 'lowpass' ? (1 - cw) / 2 : (1 + cw) / 2;
  const b1 = type === 'lowpass' ? 1 - cw : -(1 + cw);
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
}

/** Runs one section forwards from a zero initial state (direct form I). */
export function filter(c: Biquad, x: Float64Array): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Forward-backward filtering: zero phase, so peaks stay where the raw signal has them (the
 * peak counter and the manual inhale timestamps must line up). `pad` samples of odd
 * reflection at each end keep the start-up transient out of the signal, as scipy's filtfilt does.
 */
export function filtfilt(c: Biquad, x: Float64Array, pad: number): Float64Array {
  const n = x.length;
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) {
    ext[i] = 2 * x[0] - x[pad - i];
    ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i];
  }
  ext.set(x, pad);
  const forward = filter(c, ext);
  forward.reverse();
  const backward = filter(c, forward);
  backward.reverse();
  return backward.slice(pad, pad + n);
}

/**
 * Zero-phase band-pass over the breathing band, 9–90 bpm by default: detrend, then a
 * second-order Butterworth high-pass and low-pass, each run forwards and backwards. The band
 * edges therefore sit at −6 dB overall; the ±1.5 Hz aliasing traps are documented in the README.
 */
export function bandpass(x: Float64Array, fs: number, lo = 0.15, hi = 1.5): Float64Array {
  if (fs <= 2 * hi) throw new Error(`fs must exceed 2·hi: fs = ${fs}, hi = ${hi}`);
  const pad = Math.min(x.length - 2, Math.round(3 * fs));
  const high = filtfilt(biquad('highpass', lo, fs), linearDetrend(x), pad);
  return filtfilt(biquad('lowpass', hi, fs), high, pad);
}
