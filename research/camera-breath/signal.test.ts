import { describe, expect, it } from 'vitest';
import {
  acfBpm,
  autocorrelation,
  bandpass,
  fft,
  fftPeak,
  findPeaks,
  linearDetrend,
  mad,
  median,
  parabolicOffset,
  peakBpm,
  rms,
  spectralFeatures,
  spectrum,
  std,
} from './signal.ts';

describe('linearDetrend', () => {
  it('removes a slope and offset exactly', () => {
    const x = Float64Array.from({ length: 50 }, (_, i) => 2 + 0.5 * i);
    for (const v of linearDetrend(x)) expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it("leaves a zero-mean sine's rms within 1 %", () => {
    // Whole cycles, so there is no offset. A sine still correlates a little with a ramp over a
    // finite window (the fitted line's rms falls as 1/cycles), so use many cycles.
    const x = Float64Array.from({ length: 600 }, (_, i) => Math.sin((2 * Math.PI * 20 * i) / 600));
    const ratio = rms(linearDetrend(x)) / rms(x);
    expect(ratio).toBeGreaterThan(0.99);
    expect(ratio).toBeLessThan(1.01);
  });
});

describe('median', () => {
  it('handles even and odd lengths and ignores NaN', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([NaN, 1, 3])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe('spread measures', () => {
  it('rms, std and mad of a known vector', () => {
    const x = [1, 2, 3, 4, 5];
    expect(rms(x)).toBeCloseTo(Math.sqrt(55 / 5), 12);
    expect(std(x)).toBeCloseTo(Math.sqrt(2), 12);
    expect(mad(x)).toBe(1);
    expect(mad([])).toBeNull();
  });
});

describe('bandpass', () => {
  const sine = (bpm: number, fs: number, seconds: number) =>
    Float64Array.from({ length: Math.round(seconds * fs) }, (_, i) =>
      Math.sin((2 * Math.PI * bpm * i) / 60 / fs),
    );

  it('passes a 30 bpm sine with gain between 0.95 and 1.0', () => {
    const x = sine(30, 30, 60);
    const gain = rms(bandpass(x, 30)) / rms(x);
    expect(gain).toBeGreaterThan(0.95);
    expect(gain).toBeLessThanOrEqual(1);
  });

  it('is zero-phase: the filtered argmax sits on a raw peak', () => {
    // 15 bpm as well as 30: at 30 bpm the high-pass lead and low-pass lag of a single pass
    // nearly cancel, so only the lower rate would expose a forward-only filter.
    for (const bpm of [15, 30]) {
      const period = 1800 / bpm; // samples at 30 fps; sin peaks at period/4 + k·period
      const y = bandpass(sine(bpm, 30, 30), 30);
      let best = 100;
      for (let i = 100; i < 200; i++) if (y[i] > y[best]) best = i;
      const nearestRawPeak = Math.round((best - period / 4) / period) * period + period / 4;
      expect(Math.abs(best - nearestRawPeak)).toBeLessThanOrEqual(1);
    }
  });

  it('attenuates 3 bpm below 0.02 rms and 5 Hz below 0.1 rms', () => {
    expect(rms(bandpass(sine(3, 30, 60), 30))).toBeLessThan(0.02);
    expect(rms(bandpass(sine(300, 30, 60), 30))).toBeLessThan(0.1);
  });

  it('band edges 9 and 90 bpm sit at −3 dB ± 0.5 dB per pass', () => {
    // Two passes of a −3 dB edge: amplitude 0.5, so rms 0.354 for a unit sine.
    for (const bpm of [9, 90]) {
      const r = rms(bandpass(sine(bpm, 30, 120), 30));
      expect(r).toBeGreaterThan(0.33);
      expect(r).toBeLessThan(0.37);
    }
  });

  it('throws on fs ≤ 2·hi', () => {
    expect(() => bandpass(sine(30, 3, 20), 3)).toThrow(/fs must exceed/);
  });
});

// Deterministic noise for the estimator tests: an LCG and a Box–Muller Gaussian on top of it.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function gaussian(seed: number): () => number {
  const next = lcg(seed);
  return () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
}
const sineAt = (bpm: number, fs: number, seconds: number, phase = 0) =>
  Float64Array.from({ length: Math.round(seconds * fs) }, (_, i) =>
    Math.sin((2 * Math.PI * bpm * i) / 60 / fs + phase),
  );

describe('rate estimators on band-passed sines', () => {
  // 6 rates × 3 window lengths × 3 frame rates, each at 8 phases. The estimates are computed
  // once per combination and shared by the four tests below, which keeps the file fast.
  const GRID = [20, 30, 31, 35, 36, 60].flatMap((bpm) =>
    [15, 30, 60].flatMap((seconds) => [24, 30, 60].map((fs) => [bpm, seconds, fs] as const)),
  );
  type Estimates = {
    fft: number;
    acf: ReturnType<typeof acfBpm>;
    peaks: ReturnType<typeof peakBpm>;
  };
  const cache = new Map<string, Estimates[]>();
  const estimates = (bpm: number, seconds: number, fs: number): Estimates[] => {
    const key = `${bpm}/${seconds}/${fs}`;
    let rows = cache.get(key);
    if (!rows) {
      rows = Array.from({ length: 8 }, (_, phase) => {
        const y = bandpass(sineAt(bpm, fs, seconds, (phase * Math.PI) / 4), fs);
        return {
          fft: fftPeak(spectrum(y, fs)).bpm,
          acf: acfBpm(y, fs),
          peaks: peakBpm(findPeaks(y, fs), fs, seconds),
        };
      });
      cache.set(key, rows);
    }
    return rows;
  };

  it.each(GRID)('fftPeak within 0.1 bpm at %s bpm, %s s, %s fps', (bpm, seconds, fs) => {
    // 0.1, not 0.5: the eightfold zero padding alone quantises to ≤ 0.22 bpm, so only a tight
    // bound shows that the parabolic refinement is doing its job (measured worst case 0.011).
    for (const e of estimates(bpm, seconds, fs)) expect(Math.abs(e.fft - bpm)).toBeLessThan(0.1);
  });

  it.each(GRID)(
    'acfBpm within 0.5 with peak ≥ 0.65 and weak false at %s bpm, %s s, %s fps',
    (bpm, seconds, fs) => {
      // The biased ACF scales a peak at lag k by (n − k)/n: 0.8 at 20 bpm over 15 s.
      for (const e of estimates(bpm, seconds, fs)) {
        expect(e.acf).not.toBeNull();
        expect(Math.abs(e.acf!.bpm - bpm)).toBeLessThan(0.5);
        expect(e.acf!.peak).toBeGreaterThanOrEqual(0.65);
        expect(e.acf!.weak).toBe(false);
      }
    },
  );

  it.each(GRID)('count within one quantum at %s bpm, %s s, %s fps', (bpm, seconds, fs) => {
    for (const e of estimates(bpm, seconds, fs)) {
      expect(Math.abs(e.peaks.count - (bpm * seconds) / 60)).toBeLessThanOrEqual(1);
    }
  });

  it.each(GRID.filter(([, seconds]) => seconds >= 30))(
    'ibiBpm within 0.7 at %s bpm, %s s, %s fps',
    (bpm, seconds, fs) => {
      for (const e of estimates(bpm, seconds, fs)) {
        expect(e.peaks.ibiBpm).not.toBeNull();
        expect(Math.abs(e.peaks.ibiBpm! - bpm)).toBeLessThan(0.7);
      }
    },
  );
});

describe('autocorrelation', () => {
  it('is scale-invariant and r[0] is 1', () => {
    const x = bandpass(sineAt(30, 30, 30), 30);
    const r1 = autocorrelation(x, 100);
    const r100 = autocorrelation(
      x.map((v) => 100 * v),
      100,
    );
    expect(r1[0]).toBe(1);
    for (let k = 0; k <= 100; k++) expect(r100[k]).toBeCloseTo(r1[k], 9);
  });

  it('biased ACF decays: r[2T] < 0.97·r[T] on a band-passed 30 bpm sine at 30 s', () => {
    const r = autocorrelation(bandpass(sineAt(30, 30, 30), 30), 130);
    expect(r[120]).toBeLessThan(0.97 * r[60]);
  });

  it('returns zeros, not NaN, for an all-zero signal', () => {
    for (const v of autocorrelation(new Float64Array(100), 10)) expect(v).toBe(0);
  });
});

describe('acfBpm', () => {
  it('picks the first peak, not a sub-harmonic', () => {
    const a = acfBpm(bandpass(sineAt(30, 30, 30), 30), 30);
    expect(a).not.toBeNull();
    expect(Math.abs(a!.bpm - 30)).toBeLessThan(0.5);
  });

  it('is weak on pure noise and null on a zero signal', () => {
    const next = lcg(3);
    const noise = Float64Array.from({ length: 900 }, () => next() - 0.5);
    const a = acfBpm(noise, 30);
    expect(a).not.toBeNull();
    expect(a!.weak).toBe(true);
    expect(a!.peak).toBeLessThan(0.5);
    expect(acfBpm(new Float64Array(900), 30)).toBeNull();
  });
});

describe('spectrum', () => {
  it('fft throws on length 300', () => {
    expect(() => fft(new Float64Array(300), new Float64Array(300))).toThrow(/power-of-two/);
  });

  it('parabolicOffset returns 0 for a flat triple', () => {
    expect(parabolicOffset(2, 2, 2)).toBe(0);
    expect(parabolicOffset(1, 2, 1)).toBeCloseTo(0, 12); // −0: the numerator is 0
    expect(parabolicOffset(1, 2, 2)).toBeGreaterThan(0);
  });

  it('spectralFeatures: a 5 Hz tone of equal amplitude on a 30 bpm sine gives aboveBandPeakRatio in [0.8, 1.3] and a random walk gives < 0.3', () => {
    const tone = sineAt(300, 30, 30);
    const mixed = sineAt(30, 30, 30).map((v, i) => v + tone[i]);
    const sp = spectrum(mixed, 30);
    const ratio = spectralFeatures(sp, fftPeak(sp).bin).aboveBandPeakRatio;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.3);
    // A random walk is what a tracker reports on a still animal: drift, no fast motion. The
    // total-power variant reads 0.26–1.25 on these seeds; the peak variant stays far below.
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = gaussian(seed);
      let w = 0;
      const walk = linearDetrend(Float64Array.from({ length: 900 }, () => (w += g())));
      const spw = spectrum(walk, 30);
      expect(spectralFeatures(spw, fftPeak(spw).bin).aboveBandPeakRatio).toBeLessThan(0.3);
    }
  });
});

describe('findPeaks', () => {
  it('peak count on an SNR≈1 30 bpm signal is 30 ± 2 only after band-passing', () => {
    const g = gaussian(7);
    const x = sineAt(30, 30, 60).map((v) => v + Math.SQRT1_2 * g());
    expect(findPeaks(x, 30).length).toBeGreaterThanOrEqual(45);
    const count = findPeaks(bandpass(x, 30), 30).length;
    expect(Math.abs(count - 30)).toBeLessThanOrEqual(2);
  });

  it('peakBpm reports null intervals below two peaks and null spread below three', () => {
    expect(peakBpm([10], 30, 10)).toEqual({ count: 1, countBpm: 6, ibiBpm: null, ibiCv: null });
    expect(peakBpm([10, 70], 30, 10)).toEqual({ count: 2, countBpm: 12, ibiBpm: 30, ibiCv: null });
    expect(peakBpm([10, 70, 130], 30, 10).ibiCv).toBe(0);
  });
});
