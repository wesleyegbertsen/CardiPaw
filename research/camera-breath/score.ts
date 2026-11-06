// Scoring against ground truth: error metrics over accepted windows, abstain rates, and the
// pre-registered pass/fail verdict. Pure module: ES2020 only, no Node built-ins. The labels
// come from the app's own getRateStatus so "label agreement" means what the app would show.

import { getRateStatus } from '../../src/utils/rateStatus.ts';
import type { EstimateResult } from '../../src/camera/estimate.ts';
import { mean, median, std } from '../../src/camera/signal.ts';

// The sweep's three extractions, and the two an owner recording gets on its one ROI.
export type Method = 'lk-edge' | 'lk-interior' | 'profile-edge' | 'lk' | 'profile';
export type WindowSeconds = 15 | 30 | 60;

export interface WindowResult {
  cell: string;
  method: Method;
  startS: number;
  seconds: WindowSeconds;
  truthBpm: number;
  shouldAbstain: boolean; // the cell has nothing to read (no breathing, 3 px shake, …)
  good: boolean; // a clean cell: abstaining here is a false abstain
  result: EstimateResult;
}

/**
 * Pre-registered thresholds (README §4, written 2026-11-03, before any real data). A 15 s window
 * is quantised to 4 bpm by breathsPerMinute, exactly as a tapped 15 s reading is, so a reading
 * can sit 2 bpm (plus a hair) from the truth with a perfect estimate; MAE is therefore judged
 * on 30 s and 60 s windows pooled (quantum 2 and 1 bpm) and on 15 s windows separately, and
 * ±2 and the label are judged on 30 s and 60 s windows only. ±4, the under-count and High →
 * Normal use every accepted window. `null` skips a criterion.
 */
export interface Thresholds {
  maeLong: number; // 30 s and 60 s windows
  mae15: number | null;
  within2: number; // fraction of accepted 30/60 s windows within ±2 bpm
  within4: number;
  underBeyond4: number; // accepted windows reading more than 4 bpm low (an under-count hides a rise)
  labelAgreement: number; // 30/60 s windows
  highToNormal: number; // accepted windows that turn a High truth into a Normal reading
  correctAbstain: number; // abstained ÷ windows that should abstain
  falseAbstain: number; // abstained ÷ good windows, primary method only
}

export const SYNTHETIC_THRESHOLDS: Thresholds = {
  maeLong: 1.0,
  mae15: 2.0,
  within2: 0.98,
  within4: 1.0,
  underBeyond4: 0,
  labelAgreement: 1.0,
  highToNormal: 0,
  correctAbstain: 0.9,
  falseAbstain: 0.25,
};

export const REAL_THRESHOLDS: Thresholds = {
  maeLong: 2.0,
  mae15: null,
  within2: 0.9,
  within4: 0.97,
  underBeyond4: 0,
  labelAgreement: 0.9,
  highToNormal: 0,
  correctAbstain: 0.9,
  falseAbstain: 0.25,
};

export const DEFAULT_CEILINGS = { normal: 30, elevated: 35 };

export interface QualityBucket {
  bucket: string; // '[0.2, 0.4)'
  windows: number;
  abstained: number;
}

export interface Summary {
  windows: number;
  accepted: number;
  abstained: number;
  mae: Record<WindowSeconds, number | null>; // accepted windows per length
  maeLong: number | null;
  bias: number | null;
  sd: number | null;
  loa: [number, number] | null; // bias ± 1.96·sd
  within2: number | null; // 30/60 s windows
  within4: number | null;
  underBeyond4: number;
  labelAgreement: number | null; // 30/60 s windows
  highToNormal: number;
  abstainRate: number | null;
  abstainByQuality: QualityBucket[];
  correctAbstain: number | null;
  falseAbstain: number | null;
}

export const isPrimary = (method: Method): boolean => method.startsWith('lk');

const accepted = (r: WindowResult): boolean => r.result.bpm !== null;
const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

/** The signed error of an accepted window, in whole breaths per minute as the app would show. */
export function windowError(r: WindowResult): number {
  if (r.result.quantisedBpm === null) throw new Error(`window ${r.cell} @${r.startS} abstained`);
  return r.result.quantisedBpm - r.truthBpm;
}

export function summarise(rows: WindowResult[], ceilings = DEFAULT_CEILINGS): Summary {
  const pet = { normalCeiling: ceilings.normal, elevatedCeiling: ceilings.elevated };
  const acc = rows.filter(accepted);
  const errors = acc.map(windowError);
  const fine = acc.filter((r) => r.seconds >= 30); // quantum ≤ 2 bpm: ±2 and labels are decidable
  const fineErrors = fine.map(windowError);
  const maeOf = (rs: WindowResult[]) =>
    rs.length === 0 ? null : mean(rs.map((r) => Math.abs(windowError(r))));
  const mae = { 15: null, 30: null, 60: null } as Record<WindowSeconds, number | null>;
  for (const s of [15, 30, 60] as const) mae[s] = maeOf(acc.filter((r) => r.seconds === s));
  const bias = errors.length === 0 ? null : mean(errors);
  const sd = errors.length === 0 ? null : std(errors);
  let agree = 0;
  let highToNormal = 0;
  for (const r of acc) {
    const truthLabel = getRateStatus(Math.round(r.truthBpm), pet).label;
    const readLabel = getRateStatus(r.result.quantisedBpm!, pet).label;
    if (truthLabel === readLabel && r.seconds >= 30) agree++;
    if (truthLabel === 'High' && readLabel === 'Normal') highToNormal++;
  }
  // Half-open buckets; the last edge sits just above 1 so a quality of exactly 1 lands in it.
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0000001];
  const abstainByQuality: QualityBucket[] = [];
  for (let b = 0; b + 1 < edges.length; b++) {
    const inBucket = rows.filter(
      (r) => r.result.quality >= edges[b] && r.result.quality < edges[b + 1],
    );
    abstainByQuality.push({
      bucket: `[${edges[b].toFixed(1)}, ${b + 2 === edges.length ? '1.0]' : `${edges[b + 1].toFixed(1)})`}`,
      windows: inBucket.length,
      abstained: inBucket.filter((r) => !accepted(r)).length,
    });
  }
  const should = rows.filter((r) => r.shouldAbstain);
  const good = rows.filter((r) => r.good && isPrimary(r.method));
  return {
    windows: rows.length,
    accepted: acc.length,
    abstained: rows.length - acc.length,
    mae,
    maeLong: maeOf(acc.filter((r) => r.seconds !== 15)),
    bias,
    sd,
    loa: bias === null || sd === null ? null : [bias - 1.96 * sd, bias + 1.96 * sd],
    within2: ratio(fineErrors.filter((e) => Math.abs(e) <= 2).length, fineErrors.length),
    within4: ratio(errors.filter((e) => Math.abs(e) <= 4).length, errors.length),
    underBeyond4: errors.filter((e) => e < -4).length,
    labelAgreement: ratio(agree, fine.length),
    highToNormal,
    abstainRate: ratio(rows.length - acc.length, rows.length),
    abstainByQuality,
    correctAbstain: ratio(should.filter((r) => !accepted(r)).length, should.length),
    falseAbstain: ratio(good.filter((r) => !accepted(r)).length, good.length),
  };
}

export interface Criterion {
  criterion: string;
  value: string;
  threshold: string;
  pass: boolean;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${(100 * v).toFixed(1)} %`);
const bpm = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(2)} bpm`);

/** One row per criterion; a missing value (no windows to judge) fails rather than passes. */
export function verdict(s: Summary, t: Thresholds): Criterion[] {
  const atMost = (
    name: string,
    v: number | null,
    max: number,
    fmt: (v: number | null) => string,
  ) => ({
    criterion: name,
    value: fmt(v),
    threshold: `≤ ${fmt(max)}`,
    pass: v !== null && v <= max,
  });
  const atLeast = (
    name: string,
    v: number | null,
    min: number,
    fmt: (v: number | null) => string,
  ) => ({
    criterion: name,
    value: fmt(v),
    threshold: `≥ ${fmt(min)}`,
    pass: v !== null && v >= min,
  });
  const count = (v: number | null) => (v === null ? 'n/a' : String(v));
  const out: Criterion[] = [atMost('MAE, 30/60 s windows', s.maeLong, t.maeLong, bpm)];
  if (t.mae15 !== null) out.push(atMost('MAE, 15 s windows', s.mae[15], t.mae15, bpm));
  out.push(
    atLeast('Within ±2 bpm', s.within2, t.within2, pct),
    atLeast('Within ±4 bpm', s.within4, t.within4, pct),
    atMost('Under-count beyond −4 bpm', s.underBeyond4, t.underBeyond4, count),
    atLeast('Label agreement (getRateStatus)', s.labelAgreement, t.labelAgreement, pct),
    atMost('High → Normal', s.highToNormal, t.highToNormal, count),
    atLeast('Correct abstain', s.correctAbstain, t.correctAbstain, pct),
    atMost('False abstain on good windows (primary)', s.falseAbstain, t.falseAbstain, pct),
  );
  return out;
}

/**
 * One table row per criterion. With `undecided`, a criterion that had nothing to judge
 * (value n/a) shows that mark instead of FAIL: a single clip's table is a part of the
 * real-recording verdict, which is decided over all clips together.
 */
export function verdictMarkdown(v: Criterion[], undecided?: string): string {
  const lines = ['| Criterion | Value | Threshold | Result |', '|---|---|---|---|'];
  for (const c of v) {
    const result =
      c.value === 'n/a' && undecided !== undefined ? undecided : c.pass ? 'PASS' : 'FAIL';
    lines.push(`| ${c.criterion} | ${c.value} | ${c.threshold} | ${result} |`);
  }
  return lines.join('\n');
}

/** MAE, accepted/total and abstain rate per value of `factor`, values sorted numerically. */
export function breakdownMarkdown(
  rows: WindowResult[],
  factor: (r: WindowResult) => string,
  title = 'Factor',
): string {
  const groups = new Map<string, WindowResult[]>();
  for (const r of rows) {
    const k = factor(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b) : na - nb;
  });
  const lines = [
    `| ${title} | Windows | Accepted | Abstain rate | MAE (accepted) |`,
    '|---|---|---|---|---|',
  ];
  for (const k of keys) {
    const g = groups.get(k)!;
    const acc = g.filter(accepted);
    const mae = acc.length === 0 ? null : mean(acc.map((r) => Math.abs(windowError(r))));
    lines.push(
      `| ${k} | ${g.length} | ${acc.length} | ${pct(ratio(g.length - acc.length, g.length))} | ${bpm(mae)} |`,
    );
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ owner recordings

const SIDECAR_HEADER = 'clip,counter,breath_timestamp_s';

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * Reads a sidecar CSV (`clip,counter,breath_timestamp_s`, one row per breath per counter,
 * seconds from the clip start) and returns each counter's sorted timestamps for `clip`.
 * Rows for other clips are ignored; the clip is matched on its basename. CRLF is tolerated.
 */
export function parseSidecar(csv: string, clip: string): Map<string, number[]> {
  const lines = csv.split('\n').map((l) => l.replace(/\r$/, ''));
  if ((lines[0] ?? '').trim() !== SIDECAR_HEADER) {
    throw new Error(`sidecar line 1: expected header "${SIDECAR_HEADER}", got "${lines[0] ?? ''}"`);
  }
  const wanted = basename(clip);
  const out = new Map<string, number[]>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    const cols = line.split(',').map((c) => c.trim());
    const t = Number(cols[2]);
    if (cols.length !== 3 || cols[1] === '' || cols[2] === '' || !Number.isFinite(t) || t < 0) {
      throw new Error(
        `sidecar line ${i + 1}: expected "<clip>,<counter>,<seconds ≥ 0>", got "${line}"`,
      );
    }
    if (basename(cols[0]) !== wanted) continue;
    const list = out.get(cols[1]) ?? [];
    list.push(t);
    out.set(cols[1], list);
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

/**
 * The manual rate of one window: each counter's breaths in [startS, startS + seconds) as
 * bpm. Two counters that agree within one breath per 30 s of window average; three or more
 * take the median; otherwise the window has no truth (null) and is discarded.
 */
export function windowTruth(
  sidecar: Map<string, number[]>,
  startS: number,
  seconds: number,
): { bpm: number | null; counters: number; disagreement: number } {
  const counts = [...sidecar.values()].map(
    (ts) => ts.filter((t) => t >= startS && t < startS + seconds).length,
  );
  const bpms = counts.map((c) => (c * 60) / seconds);
  const disagreement = counts.length === 0 ? 0 : Math.max(...counts) - Math.min(...counts);
  let bpm: number | null = null;
  if (counts.length === 2 && disagreement <= seconds / 30) bpm = mean(bpms);
  else if (counts.length >= 3) bpm = median(bpms);
  return { bpm, counters: counts.length, disagreement };
}
