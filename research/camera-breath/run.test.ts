// The CLI's pure helpers and its exit codes. main() runs only from the command line, so
// importing this file spawns nothing, and every command exercised here fails before ffmpeg.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UsageError, cli, parseRoi, requireTwoCounters, sweepCells, windowRows } from './run.ts';

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

describe('parseRoi', () => {
  it('reads x,y,w,h in whole pixels and passes undefined through', () => {
    expect(parseRoi('80,60,120,100', 'roi')).toEqual({ x: 80, y: 60, w: 120, h: 100 });
    expect(parseRoi(undefined, 'roi')).toBeUndefined();
  });

  it.each(['80,60,120', '80,60,120,100,1', 'a,b,c,d', '80,60,0,100', '-1,60,120,100', '1.5,0,8,8'])(
    'rejects "%s" as a usage error naming the option',
    (text) => {
      expect(() => parseRoi(text, 'background')).toThrow(UsageError);
      expect(() => parseRoi(text, 'background')).toThrow('--background must be x,y,w,h');
    },
  );
});

describe('requireTwoCounters', () => {
  it('names the lone counter and passes two or more', () => {
    expect(() => requireTwoCounters(new Map([['A', [1, 2]]]))).toThrow(
      'sidecar has only one counter (A); two independent counters are required',
    );
    expect(() => requireTwoCounters(new Map([['A', [1, 2]]]))).toThrow(UsageError);
    expect(() =>
      requireTwoCounters(
        new Map([
          ['A', [1]],
          ['B', [1]],
        ]),
      ),
    ).not.toThrow();
  });
});

describe('cli exit codes', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'camera-breath-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('2 for an unknown command, a missing clip argument and an unknown subset', async () => {
    const err = quiet();
    expect(await cli(['bogus'])).toBe(2);
    expect(await cli([])).toBe(2);
    expect(await cli(['analyse'])).toBe(2);
    expect(await cli(['synth', '--subset', 'nope'])).toBe(2);
    expect(await cli(['synth', '--no-such-flag'])).toBe(2);
    expect(err.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('unknown command bogus'),
      expect.stringContaining('missing command'),
      expect.stringContaining('analyse needs a clip'),
      expect.stringContaining('unknown subset nope'),
      expect.stringContaining('--no-such-flag'),
    ]);
    expect(err.mock.calls.every((c) => String(c[0]).includes('Usage:'))).toBe(true);
  });

  it('2 for bad ceilings, a bad window and a bad ROI before any file is read', async () => {
    const err = quiet();
    const base = ['score', 'x.mp4', '--truth', 'x.csv'];
    expect(await cli([...base, '--roi', '0,0,8,8', '--ceilings', '35,30'])).toBe(2);
    expect(await cli([...base, '--roi', '0,0,8,8', '--window', '20'])).toBe(2);
    expect(await cli(['analyse', 'x.mp4', '--roi', '1,2,3'])).toBe(2);
    expect(String(err.mock.calls[0][0])).toContain('--ceilings must be');
    expect(String(err.mock.calls[1][0])).toContain('--window must be');
    expect(String(err.mock.calls[2][0])).toContain('--roi must be');
  });

  it('2 with a message for a sidecar with one counter, before the clip is probed', async () => {
    const err = quiet();
    const truth = join(dir, 'one.csv');
    writeFileSync(truth, 'clip,counter,breath_timestamp_s\ncat.mp4,A,1.0\ncat.mp4,A,3.0\n');
    expect(await cli(['score', join(dir, 'cat.mp4'), '--truth', truth, '--roi', '0,0,8,8'])).toBe(
      2,
    );
    expect(String(err.mock.calls[0][0])).toContain(
      'sidecar has only one counter (A); two independent counters are required',
    );
  });

  it('1 for a missing sidecar, naming the file rather than blaming ffmpeg', async () => {
    const err = quiet();
    const truth = join(dir, 'missing.csv');
    expect(await cli(['score', 'cat.mp4', '--truth', truth, '--roi', '0,0,8,8'])).toBe(1);
    expect(String(err.mock.calls[0][0])).toContain('missing.csv');
    expect(String(err.mock.calls[0][0])).not.toContain('not on PATH');
    // The message only: a file-system or tool error has already said what went wrong.
    expect(String(err.mock.calls[0][0])).not.toMatch(/\n\s+at /);
  });
});
