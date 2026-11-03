import { describe, expect, it } from 'vitest';
import { getRateStatus } from '../../src/utils/rateStatus.ts';
import { estimate } from './estimate.ts';

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
const sine = (bpm: number, fs: number, seconds: number, amp = 1, phase = 0) =>
  Float64Array.from(
    { length: Math.round(seconds * fs) },
    (_, i) => amp * Math.sin((2 * Math.PI * bpm * i) / 60 / fs + phase),
  );
const add = (a: Float64Array, b: Float64Array) => a.map((v, i) => v + b[i]);
// Gaussian pulses of 0.2 s at the given times, a stand-in for sharp inhales.
const pulses = (timesS: number[], fs: number, seconds: number) => {
  const x = new Float64Array(Math.round(seconds * fs));
  for (let i = 0; i < x.length; i++) {
    for (const t of timesS) x[i] += Math.exp(-((i / fs - t) ** 2) / (2 * 0.2 ** 2));
  }
  return x;
};

describe('estimate on clean signals', () => {
  it.each([20, 30, 36, 45, 60])('estimates a %s bpm sine within 0.5 bpm and accepts it', (bpm) => {
    for (const seconds of [30, 60]) {
      for (let phase = 0; phase < 4; phase++) {
        const r = estimate(sine(bpm, 30, seconds, 1, (phase * Math.PI) / 2), 30);
        expect(r.reasons).toEqual([]);
        expect(r.bpm).not.toBeNull();
        expect(Math.abs(r.bpm! - bpm)).toBeLessThan(0.5);
      }
    }
  });

  it('a 30 bpm sine at SNR≈1 is accepted with count 30 ± 2', () => {
    const g = gaussian(7);
    const r = estimate(
      sine(30, 30, 60).map((v) => v + Math.SQRT1_2 * g()),
      30,
    );
    expect(r.reasons).toEqual([]);
    expect(Math.abs(r.estimators.count - 30)).toBeLessThanOrEqual(2);
    expect(r.quantisedBpm).toBe(30);
  });

  it('30 and 31 bpm at 60 s land on different getRateStatus labels', () => {
    const r30 = estimate(sine(30, 30, 60), 30);
    const r31 = estimate(sine(31, 30, 60), 30);
    expect(r30.quantisedBpm).toBe(30);
    expect(r31.quantisedBpm).toBe(31);
    expect(getRateStatus(r30.quantisedBpm!).label).toBe('Normal');
    expect(getRateStatus(r31.quantisedBpm!).label).toBe('Elevated');
  });

  it('15 s result carries a ±2 interval and 20 s carries null', () => {
    const r15 = estimate(sine(30, 30, 15), 30);
    expect(r15.reasons).toEqual([]);
    expect(r15.interval).toEqual([r15.quantisedBpm! - 2, r15.quantisedBpm! + 2]);
    const r20 = estimate(sine(30, 30, 20), 30);
    expect(r20.reasons).toEqual([]);
    expect(r20.quantisedBpm).toBe(30);
    expect(r20.interval).toBeNull();
  });

  it('is deterministic (two calls, toEqual)', () => {
    const g = gaussian(11);
    const x = sine(24, 30, 30).map((v) => v + 0.5 * g());
    expect(estimate(x, 30)).toEqual(estimate(x, 30));
  });
});

describe('estimate abstains', () => {
  it('abstains no-signal on a zero signal', () => {
    const r = estimate(new Float64Array(900), 30);
    expect(r.reasons).toEqual(['no-signal']);
    expect(r.bpm).toBeNull();
    expect(r.quantisedBpm).toBeNull();
  });

  it('abstains on pure noise', () => {
    for (const seed of [1, 2, 3]) {
      const next = lcg(seed);
      const r = estimate(
        Float64Array.from({ length: 900 }, () => next() - 0.5),
        30,
      );
      expect(r.bpm).toBeNull();
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('reports few-tracks before no-signal for an all-zero signal with validTrackRatio 0', () => {
    const r = estimate(new Float64Array(900), 30, { validTrackRatio: 0 });
    expect(r.reasons[0]).toBe('few-tracks');
    expect(r.features.validTrackRatio).toBe(0);
  });

  it('abstains shake at borderRms 1.5 and not at 0.65', () => {
    const x = sine(30, 30, 30);
    expect(estimate(x, 30, { borderRms: 1.5 }).reasons).toEqual(['shake']);
    const steady = estimate(x, 30, { borderRms: 0.65 });
    expect(steady.reasons).toEqual([]);
    expect(steady.features.borderRms).toBe(0.65);
  });

  it('fast-motion when a 5 Hz tone of equal amplitude rides on 30 bpm at 30 fps', () => {
    const r = estimate(add(sine(30, 30, 30), sine(300, 30, 30)), 30);
    expect(r.reasons).toEqual(['fast-motion']);
    expect(r.bpm).toBeNull();
  });

  it('a 5 Hz tone at 0.3 amplitude is still accepted as 30', () => {
    const r = estimate(add(sine(30, 30, 30), sine(300, 30, 30, 0.3)), 30);
    expect(r.reasons).toEqual([]);
    expect(r.quantisedBpm).toBe(30);
  });

  it('a random walk (a still animal under a drifting tracker) does not trigger fast-motion', () => {
    // White noise would: its strongest above-band bin beats the in-band peak by construction.
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = gaussian(seed);
      let w = 0;
      const r = estimate(
        Float64Array.from({ length: 900 }, () => (w += g())),
        30,
      );
      expect(r.bpm).toBeNull();
      expect(r.reasons).not.toContain('fast-motion');
    }
  });

  it('too-short at 15 s for 8 bpm, not for 18 bpm', () => {
    expect(estimate(sine(8, 30, 15), 30).reasons).toContain('too-short');
    expect(estimate(sine(18, 30, 15), 30).reasons).not.toContain('too-short');
    expect(estimate(sine(30, 30, 9), 30).reasons).toEqual(['too-short']);
  });

  it('irregular when inter-breath intervals alternate 1.5 s / 3 s', () => {
    const times: number[] = [];
    for (let t = 1, k = 0; t < 59; k++) {
      times.push(t);
      t += k % 2 === 0 ? 1.5 : 3;
    }
    const r = estimate(pulses(times, 30, 60), 30);
    expect(r.reasons).toContain('irregular');
    expect(r.features.ibiCv).toBeGreaterThan(0.3);
  });

  it('two peaks only gives ibiCv 1 and irregular', () => {
    const r = estimate(sine(10, 30, 12), 30);
    expect(r.estimators.count).toBe(2);
    expect(r.features.ibiCv).toBe(1);
    expect(r.reasons).toContain('irregular');
  });
});

describe('the 24 fps purr limit', () => {
  // A 25 Hz purr sampled at 24 fps is exactly a 1 Hz sine: no 1-D cue can tell it from 60 bpm.
  const purr = (amp: number) => sine(1500, 24, 30, amp);

  it('documents the limit: a dominant 25 Hz tone sampled at 24 fps is accepted as 60', () => {
    const r = estimate(add(purr(1), sine(30, 24, 30, 0.3)), 24);
    expect(r.reasons).toEqual([]);
    expect(r.quantisedBpm).toBe(60);
  });

  it('equal-amplitude purr and breathing at 24 fps abstain', () => {
    for (let phase = 0; phase < 4; phase++) {
      const r = estimate(add(purr(1), sine(30, 24, 30, 1, (phase * Math.PI) / 2)), 24);
      expect(r.bpm).toBeNull();
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });
});
