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
