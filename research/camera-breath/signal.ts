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

/** In-place iterative radix-2 FFT. Throws unless both arrays have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0 || im.length !== n) {
    throw new Error(`fft needs a power-of-two length, got ${n} (im ${im.length})`);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Sub-sample offset of the vertex of the parabola through three equally spaced samples. */
export function parabolicOffset(ym1: number, y0: number, yp1: number): number {
  const d = ym1 - 2 * y0 + yp1;
  return d === 0 ? 0 : (0.5 * (ym1 - yp1)) / d;
}

export interface Spectrum {
  fs: number;
  n: number;
  m: number; // FFT length: first power of two ≥ 8n
  mag: Float64Array; // |X[k]| for k < m/2
  padBinsPerRaw: number; // m/n: zero-padded bins per raw-resolution bin
}

/**
 * Hann-windowed magnitude spectrum, zero-padded eightfold so a parabolic fit around the peak
 * resolves fractions of a bpm even on a 15 s window.
 */
export function spectrum(x: Float64Array, fs: number): Spectrum {
  const n = x.length;
  let m = 1;
  while (m < 8 * n) m <<= 1;
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const mag = new Float64Array(m / 2);
  for (let k = 0; k < m / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return { fs, n, m, mag, padBinsPerRaw: m / n };
}

/** The strongest bin inside [lo, hi] Hz, refined by a parabolic fit, as bpm. */
export function fftPeak(sp: Spectrum, lo = 0.15, hi = 1.5): { bpm: number; bin: number } {
  const { mag, m, fs } = sp;
  const k0 = Math.ceil((lo * m) / fs);
  const k1 = Math.floor((hi * m) / fs);
  let kb = k0;
  for (let k = k0; k <= k1; k++) if (mag[k] > mag[kb]) kb = k;
  const offset = parabolicOffset(mag[kb - 1], mag[kb], mag[kb + 1]);
  return { bpm: (((kb + offset) * fs) / m) * 60, bin: kb };
}

/**
 * How dominant the chosen peak is. `peakShare` is its power share within 0.1–3 Hz (the
 * no-signal gate); `aboveBandPeakRatio` compares the strongest component above 1.5 Hz with the
 * peak itself (the fast-motion gate: a purr or tremor aliased into view). `aboveBandRatio` is
 * the total-power variant, reported for calibration only because it fires on broadband noise.
 */
export function spectralFeatures(
  sp: Spectrum,
  bin: number,
): { peakShare: number; aboveBandRatio: number; aboveBandPeakRatio: number } {
  const { mag, m, fs, padBinsPerRaw } = sp;
  let total = 0;
  let inPeak = 0;
  let above = 0;
  let aboveMax = 0;
  let peakPower = 0;
  for (let k = 1; k < m / 2; k++) {
    const f = (k * fs) / m;
    const p = mag[k] ** 2;
    const nearPeak = Math.abs(k - bin) <= padBinsPerRaw;
    if (f >= 0.1 && f <= 3) {
      total += p;
      if (nearPeak) inPeak += p;
    }
    if (nearPeak) peakPower += p;
    if (f > 1.5) {
      above += p;
      if (p > aboveMax) aboveMax = p;
    }
  }
  return {
    peakShare: inPeak / total,
    aboveBandRatio: above / peakPower,
    aboveBandPeakRatio: aboveMax / mag[bin] ** 2,
  };
}

/**
 * Biased autocorrelation r[k] = Σ x[t]·x[t+k] / n, normalised so r[0] = 1. Biased on purpose:
 * the (n − k)/n taper makes r fall off with lag, so the first breathing period wins over its
 * multiples. An all-zero input returns zeros rather than NaN.
 */
export function autocorrelation(x: Float64Array, maxLag: number): Float64Array {
  const n = x.length;
  const r = new Float64Array(maxLag + 1);
  for (let k = 0; k <= maxLag; k++) {
    let sum = 0;
    for (let t = 0; t + k < n; t++) sum += x[t] * x[t + k];
    r[k] = sum / n;
  }
  const r0 = r[0];
  if (r0 <= 0) return r;
  for (let k = 0; k <= maxLag; k++) r[k] /= r0;
  return r;
}

/**
 * Breathing rate from the first autocorrelation peak at a lag inside [1/hi, 1/lo] seconds.
 * A peak below `minPeak` is still reported, flagged `weak`, so the feature exists for
 * calibration; null when the signal is zero or has no local maximum in range.
 */
export function acfBpm(
  x: Float64Array,
  fs: number,
  lo = 0.15,
  hi = 1.5,
  minPeak = 0.5,
): { bpm: number; peak: number; weak: boolean } | null {
  const n = x.length;
  const kmin = Math.max(1, Math.round(fs / hi));
  const kmax = Math.min(n - 2, Math.round(fs / lo));
  if (kmax < kmin || rms(x) === 0) return null;
  const r = autocorrelation(x, kmax + 1);
  const at = (k: number) => (60 * fs) / (k + parabolicOffset(r[k - 1], r[k], r[k + 1]));
  let best: { bpm: number; peak: number; weak: boolean } | null = null;
  for (let k = kmin; k <= kmax; k++) {
    if (!(r[k] > r[k - 1] && r[k] >= r[k + 1])) continue;
    if (r[k] >= minPeak) return { bpm: at(k), peak: r[k], weak: false };
    if (best === null || r[k] > best.peak) best = { bpm: at(k), peak: r[k], weak: true };
  }
  return best;
}

/**
 * Indices of local maxima whose prominence is at least `prominenceSigma` standard deviations;
 * two peaks closer than `minDistanceS` keep only the higher one.
 */
export function findPeaks(
  x: Float64Array,
  fs: number,
  minDistanceS = 0.5,
  prominenceSigma = 0.3,
): number[] {
  const n = x.length;
  const minProminence = prominenceSigma * std(x);
  const minDistance = Math.round(minDistanceS * fs);
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(x[i] > x[i - 1] && x[i] >= x[i + 1])) continue;
    let leftMin = x[i];
    let rightMin = x[i];
    for (let j = i - 1; j >= 0 && x[j] <= x[i]; j--) leftMin = Math.min(leftMin, x[j]);
    for (let j = i + 1; j < n && x[j] <= x[i]; j++) rightMin = Math.min(rightMin, x[j]);
    if (x[i] - Math.max(leftMin, rightMin) < minProminence) continue;
    const last = peaks.length - 1;
    if (last >= 0 && i - peaks[last] < minDistance) {
      if (x[i] > x[peaks[last]]) peaks[last] = i;
    } else {
      peaks.push(i);
    }
  }
  return peaks;
}

/**
 * Rate from counted peaks (what an owner tapping along would get) and from the median
 * inter-breath interval, with the interval spread as a regularity feature.
 */
export function peakBpm(
  peaks: number[],
  fs: number,
  seconds: number,
): { count: number; countBpm: number; ibiBpm: number | null; ibiCv: number | null } {
  const count = peaks.length;
  const ibis = peaks.slice(1).map((p, i) => p - peaks[i]);
  const ibiMedian = median(ibis);
  return {
    count,
    countBpm: Math.round((count * 60) / seconds),
    ibiBpm: ibiMedian === null ? null : (60 * fs) / ibiMedian,
    ibiCv: count < 3 ? null : std(ibis) / mean(ibis),
  };
}
