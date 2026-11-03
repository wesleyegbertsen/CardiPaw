import { describe, expect, it } from 'vitest';
import { bandpass, linearDetrend, mad, median, rms, std } from './signal.ts';

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
