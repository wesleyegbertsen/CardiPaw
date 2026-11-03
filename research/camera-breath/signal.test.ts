import { describe, expect, it } from 'vitest';
import { linearDetrend, mad, median, rms, std } from './signal.ts';

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
