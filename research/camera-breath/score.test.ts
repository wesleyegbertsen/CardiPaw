import { describe, expect, it } from 'vitest';
import type { EstimateResult } from './estimate.ts';
import {
  REAL_THRESHOLDS,
  SYNTHETIC_THRESHOLDS,
  breakdownMarkdown,
  summarise,
  verdict,
  verdictMarkdown,
} from './score.ts';
import type { Method, WindowResult, WindowSeconds } from './score.ts';

/** A window whose estimate read `read` (null: abstained) against `truth`. */
function row(o: {
  truth: number;
  read: number | null;
  seconds?: WindowSeconds;
  method?: Method;
  quality?: number;
  shouldAbstain?: boolean;
  good?: boolean;
  cell?: string;
}): WindowResult {
  const seconds = o.seconds ?? 30;
  const result: EstimateResult = {
    bpm: o.read,
    rawBpm: o.read,
    breaths: o.read === null ? null : Math.round((o.read * seconds) / 60),
    quantisedBpm: o.read,
    interval: null,
    estimators: { fft: o.read, acf: o.read, ibi: o.read, count: 0 },
    quality: o.quality ?? (o.read === null ? 0.3 : 0.95),
    reasons: o.read === null ? ['no-signal'] : [],
    features: {
      seconds,
      rmsRaw: 1,
      peakShare: 0.8,
      aboveBandPeakRatio: 0,
      aboveBandRatio: 0,
      acfPeak: 0.8,
      disagreement: 0,
      ibiCv: 0.05,
      twitchFraction: 0,
    },
  };
  return {
    cell: o.cell ?? 'cell',
    method: o.method ?? 'lk-edge',
    startS: 0,
    seconds,
    truthBpm: o.truth,
    shouldAbstain: o.shouldAbstain ?? false,
    good: o.good ?? !o.shouldAbstain,
    result,
  };
}

describe('summarise', () => {
  it('computes MAE, bias and LoA on a hand-made set', () => {
    const s = summarise([
      row({ truth: 30, read: 31 }),
      row({ truth: 30, read: 29 }),
      row({ truth: 30, read: 32, seconds: 60 }),
      row({ truth: 30, read: 30, seconds: 15 }),
    ]);
    expect(s.windows).toBe(4);
    expect(s.accepted).toBe(4);
    expect(s.mae[30]).toBe(1);
    expect(s.mae[60]).toBe(2);
    expect(s.mae[15]).toBe(0);
    expect(s.maeLong).toBeCloseTo(4 / 3, 9);
    expect(s.bias).toBeCloseTo(0.5, 9);
    expect(s.sd).toBeCloseTo(Math.sqrt(1.25), 9);
    expect(s.loa![0]).toBeCloseTo(0.5 - 1.96 * Math.sqrt(1.25), 9);
    expect(s.loa![1]).toBeCloseTo(0.5 + 1.96 * Math.sqrt(1.25), 9);
    expect(s.within2).toBe(1);
    expect(s.within4).toBe(1);
    expect(s.labelAgreement).toBeCloseTo(1 / 3, 9); // 31 and 32 are Elevated against a Normal truth
    expect(s.abstainRate).toBe(0);
  });

  it('judges ±2 and the label on 30/60 s windows only, ±4 and MAE on all', () => {
    // A perfect 15 s estimate of 29.93 bpm reads 7.5 breaths → 8 → 32 bpm: the app's own quantum.
    const s = summarise([
      row({ truth: 29.93, read: 32, seconds: 15 }),
      row({ truth: 29.93, read: 28, seconds: 15 }),
      row({ truth: 30, read: 30 }),
    ]);
    expect(s.within2).toBe(1); // 2/3 if the 15 s rows counted
    expect(s.labelAgreement).toBe(1);
    expect(s.within4).toBe(1);
    expect(s.mae[15]).toBeCloseTo(2, 9); // +2.07 and −1.93
    expect(s.maeLong).toBe(0);
    expect(summarise([row({ truth: 29.93, read: 32, seconds: 15 })]).within2).toBeNull();
  });

  it('uses the truth as the app would round it and the given ceilings', () => {
    const rows = [row({ truth: 30.4, read: 30 }), row({ truth: 30.6, read: 30 })];
    expect(summarise(rows).labelAgreement).toBe(0.5);
    expect(summarise(rows, { normal: 31, elevated: 35 }).labelAgreement).toBe(1);
  });

  it('counts an accepted −5 bpm error as underBeyond4', () => {
    expect(summarise([row({ truth: 30, read: 25 })]).underBeyond4).toBe(1);
    expect(summarise([row({ truth: 25, read: 30 })]).underBeyond4).toBe(0);
    expect(summarise([row({ truth: 30, read: 26 })]).underBeyond4).toBe(0);
  });

  it('flags High→Normal', () => {
    const s = summarise([row({ truth: 36, read: 30 }), row({ truth: 36, read: 36 })]);
    expect(s.highToNormal).toBe(1);
    expect(s.labelAgreement).toBe(0.5);
    expect(summarise([row({ truth: 36, read: 33 })]).highToNormal).toBe(0); // High → Elevated
  });

  it('abstain buckets sum to the abstain count', () => {
    const rows = [
      row({ truth: 30, read: null, quality: 0 }),
      row({ truth: 30, read: null, quality: 0.19 }),
      row({ truth: 30, read: null, quality: 0.5 }),
      row({ truth: 30, read: null, quality: 0.79 }),
      row({ truth: 30, read: 30, quality: 0.8 }),
      row({ truth: 30, read: 30, quality: 1 }),
    ];
    const s = summarise(rows);
    expect(s.abstained).toBe(4);
    expect(s.abstainByQuality.map((b) => b.bucket)).toEqual([
      '[0.0, 0.2)',
      '[0.2, 0.4)',
      '[0.4, 0.6)',
      '[0.6, 0.8)',
      '[0.8, 1.0]',
    ]);
    expect(s.abstainByQuality.map((b) => b.windows)).toEqual([2, 0, 1, 1, 2]);
    expect(s.abstainByQuality.reduce((a, b) => a + b.abstained, 0)).toBe(4);
    expect(s.abstainByQuality.reduce((a, b) => a + b.windows, 0)).toBe(rows.length);
  });

  it('falseAbstain counts only primary-method rows', () => {
    const s = summarise([
      row({ truth: 30, read: 30, method: 'lk-edge' }),
      row({ truth: 30, read: null, method: 'lk-interior' }),
      row({ truth: 30, read: null, method: 'profile-edge' }),
    ]);
    expect(s.falseAbstain).toBe(0.5); // 2/3 if the profile row counted
  });

  it('correctAbstain is judged on the rows that should abstain', () => {
    const s = summarise([
      row({ truth: 30, read: null, shouldAbstain: true }),
      row({ truth: 30, read: 30, shouldAbstain: true }),
      row({ truth: 30, read: 30 }),
    ]);
    expect(s.correctAbstain).toBe(0.5);
    expect(s.falseAbstain).toBe(0);
    expect(summarise([row({ truth: 30, read: 30 })]).correctAbstain).toBeNull();
  });
});

describe('verdict', () => {
  const passing = [
    ...Array.from({ length: 50 }, (_, i) => row({ truth: 30, read: 30, seconds: i % 2 ? 30 : 60 })),
    row({ truth: 30, read: 30, seconds: 15 }),
    row({ truth: 30, read: null, shouldAbstain: true }),
  ];

  it('marks each criterion PASS/FAIL against SYNTHETIC_THRESHOLDS', () => {
    const ok = verdict(summarise(passing), SYNTHETIC_THRESHOLDS);
    expect(ok).toHaveLength(9);
    expect(ok.every((c) => c.pass)).toBe(true);
    const failing = [...passing, row({ truth: 36, read: 30 }), row({ truth: 30, read: 25 })];
    const bad = verdict(summarise(failing), SYNTHETIC_THRESHOLDS);
    const failed = bad.filter((c) => !c.pass).map((c) => c.criterion);
    expect(failed).toContain('High → Normal');
    expect(failed).toContain('Under-count beyond −4 bpm');
    expect(failed).toContain('Label agreement (getRateStatus)');
    expect(failed).toContain('Within ±2 bpm');
    expect(bad.find((c) => c.criterion === 'MAE, 15 s windows')!.pass).toBe(true);
  });

  it('fails a criterion with nothing to judge and skips a null threshold', () => {
    const none = verdict(summarise([row({ truth: 30, read: null })]), SYNTHETIC_THRESHOLDS);
    expect(none.find((c) => c.criterion.startsWith('MAE'))!.value).toBe('n/a');
    expect(none.find((c) => c.criterion.startsWith('MAE'))!.pass).toBe(false);
    expect(verdict(summarise(passing), REAL_THRESHOLDS).map((c) => c.criterion)).not.toContain(
      'MAE, 15 s windows',
    );
  });

  it('verdictMarkdown has one row per criterion', () => {
    const v = verdict(summarise(passing), SYNTHETIC_THRESHOLDS);
    const lines = verdictMarkdown(v).split('\n');
    expect(lines).toHaveLength(2 + v.length);
    expect(lines[2]).toMatch(/^\| MAE, 30\/60 s windows \| 0\.00 bpm \| ≤ 1\.00 bpm \| PASS \|$/);
  });

  it('breakdownMarkdown sorts factor values numerically with a row each', () => {
    const rows = [
      row({ truth: 30, read: 30, cell: '10' }),
      row({ truth: 30, read: null, cell: '2' }),
      row({ truth: 30, read: 32, cell: '2' }),
    ];
    const lines = breakdownMarkdown(rows, (r) => r.cell, 'Cell').split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe('| 2 | 2 | 1 | 50.0 % | 2.00 bpm |');
    expect(lines[3]).toBe('| 10 | 1 | 1 | 0.0 % | 0.00 bpm |');
  });
});
