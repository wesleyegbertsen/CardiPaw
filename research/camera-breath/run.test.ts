// The CLI's pure helpers: cell lists and window slicing. main() runs only from the command
// line, so importing this file spawns nothing.
import { describe, expect, it } from 'vitest';
import { sweepCells, windowRows } from './run.ts';

describe('sweepCells', () => {
  it('smoke has 14 cells; core has 378 with one seed and 1134 with three', () => {
    expect(sweepCells('smoke', 1)).toHaveLength(14);
    expect(sweepCells('core', 1)).toHaveLength(378);
    expect(sweepCells('core', 3)).toHaveLength(1134);
  });

  it('--seeds applies to the core grid as well as the nuisance and refusal cells', () => {
    const cells = sweepCells('core', 3);
    for (const group of ['core', 'nuisance', 'refusal'] as const) {
      const seeds = new Set(cells.filter((c) => c.group === group).map((c) => c.params.seed));
      expect([...seeds].sort()).toEqual([1, 2, 3]);
    }
  });

  it('every registered refusal condition has at least one must-abstain cell', () => {
    const must = sweepCells('core', 1).filter((c) => c.shouldAbstain);
    expect(must.some((c) => c.params.amplitudePx === 0)).toBe(true);
    expect(must.some((c) => (c.params.shakeRmsPx ?? 0) >= 3)).toBe(true);
    const flicker = must.filter((c) => c.params.flicker != null && c.params.amplitudePx > 0);
    expect(flicker.length).toBeGreaterThan(0);
    for (const c of flicker) {
      expect(c.params.flicker!.hz).toBeGreaterThanOrEqual(0.15);
      expect(c.params.flicker!.hz).toBeLessThanOrEqual(1.5);
      expect(c.params.amplitudePx).toBeLessThanOrEqual(0.5);
      expect(c.good).toBe(false);
    }
  });

  it('rejects an unknown subset', () => {
    expect(() => sweepCells('bogus', 1)).toThrow('unknown subset bogus');
  });
});

describe('windowRows', () => {
  it('slices non-overlapping 15/30/60 s windows and keeps 15 s at 12 bpm out of "good"', () => {
    const fps = 30;
    const signal = Float64Array.from({ length: 60 * fps }, (_, i) =>
      Math.sin((2 * Math.PI * 12 * i) / 60 / fps),
    );
    // A summed phase lands a hair above 12; the exclusion must still apply.
    const rows = windowRows(
      'c',
      'lk-edge',
      { signal, quality: {} },
      fps,
      () => 12.000000000000032,
      {
        shouldAbstain: false,
        good: true,
      },
    );
    expect(rows.map((r) => `${r.seconds}@${r.startS}`)).toEqual([
      '15@0',
      '15@15',
      '15@30',
      '15@45',
      '30@0',
      '30@30',
      '60@0',
    ]);
    expect(rows.filter((r) => r.seconds === 15).map((r) => r.good)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(rows.filter((r) => r.seconds !== 15).map((r) => r.good)).toEqual([true, true, true]);
    expect(rows.every((r) => r.result.features.seconds === r.seconds)).toBe(true);
  });
});
