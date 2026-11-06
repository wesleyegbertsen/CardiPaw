import { describe, expect, it } from 'vitest';
import type { EstimateResult } from '../../src/camera/estimate.ts';
import {
  REAL_THRESHOLDS,
  SYNTHETIC_THRESHOLDS,
  breakdownMarkdown,
  parseSidecar,
  summarise,
  verdict,
  verdictMarkdown,
  windowTruth,
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

  it('within2 excludes abstained windows and an error of exactly 3', () => {
    expect(summarise([row({ truth: 30, read: 33 }), row({ truth: 30, read: null })]).within2).toBe(
      0,
    );
    expect(summarise([row({ truth: 30, read: 32 }), row({ truth: 30, read: null })]).within2).toBe(
      1,
    );
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
      row({ truth: 30, read: null, method: 'profile' }),
      row({ truth: 30, read: 30, method: 'lk' }),
    ]);
    expect(s.falseAbstain).toBeCloseTo(1 / 3, 9); // 3/5 if the profile rows counted
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

  it('verdictMarkdown can leave a criterion with nothing to judge undecided', () => {
    // One good clip has no window that should abstain: per clip that is undecided, not FAIL.
    const v = verdict(summarise([row({ truth: 30, read: 30 })]), REAL_THRESHOLDS);
    const abstain = (md: string) => md.split('\n').find((l) => l.startsWith('| Correct abstain'));
    expect(abstain(verdictMarkdown(v))).toBe('| Correct abstain | n/a | ≥ 90.0 % | FAIL |');
    expect(abstain(verdictMarkdown(v, '—'))).toBe('| Correct abstain | n/a | ≥ 90.0 % | — |');
    expect(verdictMarkdown(v, '—')).toContain(
      '| MAE, 30/60 s windows | 0.00 bpm | ≤ 2.00 bpm | PASS |',
    );
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

describe('parseSidecar', () => {
  const csv = [
    'clip,counter,breath_timestamp_s',
    'cat.mp4,A,2.0',
    'cat.mp4,A,0.5',
    'cat.mp4,B,0.7',
    'dog.mp4,A,1.0',
    'cat.mp4,B,2.2',
    '',
  ].join('\r\n');

  it('reads the header and CRLF, sorting each counter', () => {
    const s = parseSidecar(csv, 'clips/cat.mp4');
    expect([...s.keys()]).toEqual(['A', 'B']);
    expect(s.get('A')).toEqual([0.5, 2]);
    expect(s.get('B')).toEqual([0.7, 2.2]);
  });

  it('ignores rows for another clip and matches on the basename', () => {
    expect(parseSidecar(csv, 'C:\\clips\\dog.mp4').get('A')).toEqual([1]);
    expect(parseSidecar(csv, 'dog.mp4').has('B')).toBe(false);
    expect(parseSidecar(csv, 'other.mp4').size).toBe(0);
  });

  it('throws on a malformed row naming the line, and on a wrong header', () => {
    const bad = csv.replace('cat.mp4,B,0.7', 'cat.mp4,B,soon');
    expect(() => parseSidecar(bad, 'cat.mp4')).toThrow('sidecar line 4');
    expect(() => parseSidecar(csv.replace('dog.mp4,A,1.0', 'dog.mp4,A'), 'cat.mp4')).toThrow(
      'line 5',
    );
    expect(() => parseSidecar('clip,counter,t\n', 'cat.mp4')).toThrow('line 1');
  });
});

describe('windowTruth', () => {
  const every = (step: number, offset: number, seconds: number) =>
    Array.from({ length: Math.floor(seconds / step) }, (_, i) => offset + i * step);

  it('averages two agreeing counters', () => {
    // A: 15 breaths in [0, 30); B: 14.
    const s = new Map([
      ['A', every(2, 0.1, 30)],
      ['B', every(2, 0.1, 28)],
    ]);
    expect(windowTruth(s, 0, 30)).toEqual({ bpm: 29, counters: 2, disagreement: 1 });
    expect(windowTruth(s, 30, 30)).toEqual({ bpm: 0, counters: 2, disagreement: 0 }); // nothing marked
  });

  it('discards a window where counters differ by 2 breaths in 30 s', () => {
    const s = new Map([
      ['A', every(2, 0.1, 30)],
      ['B', every(2, 0.1, 26)],
    ]);
    expect(windowTruth(s, 0, 30)).toEqual({ bpm: null, counters: 2, disagreement: 2 });
    // Over 60 s the same 2-breath difference is within one per 30 s.
    expect(windowTruth(s, 0, 60).bpm).toBe(14);
  });

  it('uses the median of three counters, and has no truth for one', () => {
    const s = new Map([
      ['A', every(2, 0.1, 30)],
      ['B', every(2, 0.1, 26)],
      ['C', every(2, 0.1, 20)],
    ]);
    expect(windowTruth(s, 0, 30)).toEqual({ bpm: 26, counters: 3, disagreement: 5 });
    expect(windowTruth(new Map([['A', every(2, 0.1, 30)]]), 0, 30).bpm).toBeNull();
    expect(windowTruth(new Map(), 0, 30)).toEqual({ bpm: null, counters: 0, disagreement: 0 });
  });
});
