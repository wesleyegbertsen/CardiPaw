// Command-line front end of the camera-breath research prototype (#130). Runs on Node 24
// (type stripping, no build step) and needs ffmpeg 8 (ffmpeg and ffprobe) on PATH for
// anything that touches a video file. Nothing here is bundled into the app.
// Usage:
//   node research/camera-breath/run.ts synth [--subset smoke|core|full] [--seeds N] [--encode]
//       [--method lk|profile|both] [--out research/camera-breath/out]
//     Renders the synthetic sweep, scores it against the pre-registered thresholds, writes
//     out/synthetic.{json,md} and exits 1 when any criterion fails. --seeds N (default 1) gives
//     every seeded grid of the core subset the seeds 1 … N. --encode round-trips every cell
//     through libx264 (CRF 28) first. Never run by vitest or CI: core takes ~15 minutes per seed.
//   node research/camera-breath/run.ts analyse <clip> --roi x,y,w,h [--background x,y,w,h]
//       [--fps 30] [--size WxH | --longest 320] [--window 30] [--method lk|profile|both]
//       [--dump <waveform.csv>] [--dump-frame <first.pgm>] [--json]
//     Probes the clip, prints the working size, decodes it and estimates every window. ROI
//     coordinates are working-size pixels: run once with --dump-frame and read them off the
//     PGM. The background strip (default: the top 40 rows) must show static scene only.
//   node research/camera-breath/run.ts score <clip> --truth <sidecar.csv> --roi x,y,w,h
//       [--background x,y,w,h] [--window 15|30|60] [--ceilings 30,35] [--method lk|profile|both]
//       [--degraded] [--json <out.json>] [--md <out.md>]
//     analyse, then compares each window with the counters' sidecar (README: sidecar CSV)
//     against the real-recording thresholds. --degraded marks a clip that should abstain.
//   Paths are relative to the shell, not to this folder: keep clips and sidecars under
//   research/camera-breath/clips/ and write dumps and reports to research/camera-breath/out/,
//   the two git-ignored directories.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { getRateStatus } from '../../src/utils/rateStatus.ts';
import { MIN_DELIVERED_FPS } from '../../src/camera/capture.ts';
import { estimate } from '../../src/camera/estimate.ts';
import type { EstimateResult } from '../../src/camera/estimate.ts';
import {
  ffmpegMissingHint,
  probe,
  readFrames,
  workingSize,
  writeClip,
  writePgm,
} from './ingest.ts';
import type { ProbeInfo } from './ingest.ts';
import { lkMotion, profileMotion, topStrip } from '../../src/camera/motion.ts';
import type { Frame, MotionSignal, Roi } from '../../src/camera/motion.ts';
import {
  DEFAULT_CEILINGS,
  REAL_THRESHOLDS,
  SYNTHETIC_THRESHOLDS,
  breakdownMarkdown,
  isPrimary,
  parseSidecar,
  summarise,
  verdict,
  verdictMarkdown,
  windowTruth,
} from './score.ts';
import type { Method, Summary, WindowResult, WindowSeconds } from './score.ts';
import { bandpass, linearDetrend } from '../../src/camera/signal.ts';
import { makeScene } from '../../src/camera/synth.ts';
import type { SceneParams } from '../../src/camera/synth.ts';

const USAGE = `Usage:
  node research/camera-breath/run.ts synth [--subset smoke|core|full] [--seeds N] [--encode]
      [--method lk|profile|both] [--out <dir>]
  node research/camera-breath/run.ts analyse <clip> --roi x,y,w,h [--background x,y,w,h]
      [--fps 30] [--size WxH | --longest 320] [--window 30] [--method lk|profile|both]
      [--dump <waveform.csv>] [--dump-frame <first.pgm>] [--json]
  node research/camera-breath/run.ts score <clip> --truth <sidecar.csv> --roi x,y,w,h
      [--background x,y,w,h] [--window 15|30|60] [--ceilings 30,35] [--method lk|profile|both]
      [--degraded] [--json <out.json>] [--md <out.md>]
ROI and background are in working-size pixels (analyse prints the size; --dump-frame writes the
first frame as PGM). The background strip (default: top 40 rows) must show static scene only.
Paths are relative to the shell: keep clips and sidecars in research/camera-breath/clips/ and
write dumps and reports to research/camera-breath/out/ (both git-ignored).
Needs ffmpeg 8 on PATH. See research/camera-breath/README.md.`;

const DEFAULT_OUT = fileURLToPath(new URL('./out', import.meta.url));
const WINDOWS: readonly WindowSeconds[] = [15, 30, 60];
const CLIP_SECONDS = 60;
const SWEEP_SIZE = { width: 192, height: 144 }; // what the gates were calibrated on

/** A bad command line or sidecar: exit 2 with the usage text. */
export class UsageError extends Error {}

// ------------------------------------------------------------------ synthetic sweep

interface Cell {
  name: string;
  group: 'core' | 'nuisance' | 'refusal' | 'smoke';
  params: SceneParams;
  shouldAbstain: boolean;
  good: boolean;
  factors: Record<string, string | number>;
  keepAs?: string; // --encode keeps this cell's clip under out/ for the manual checks
}

function cell(
  group: Cell['group'],
  p: Omit<SceneParams, 'seconds' | 'contrast'> & { contrast?: number },
  truth?: { shouldAbstain: boolean; good: boolean },
  keepAs?: string,
): Cell {
  const params: SceneParams = { contrast: 40, seconds: CLIP_SECONDS, ...p };
  const A = params.amplitudePx;
  const shake = params.shakeRmsPx ?? 0;
  const flicker = params.flicker ?? null;
  const inBandFlicker = flicker !== null && flicker.hz >= 0.15 && flicker.hz <= 1.5;
  const factors = {
    group,
    seed: params.seed,
    bpm: params.bpm,
    A,
    shake,
    contrast: params.contrast,
    flicker: flicker === null ? 'none' : `${flicker.hz} Hz / ${100 * flicker.depth} %`,
    purr: params.purr ? `${params.purr.hz} Hz / ${params.purr.amplitudePx} px` : 'none',
    twitches: params.twitches ?? 0,
    ramp: params.rateRampBpm ?? 0,
    fps: params.fps,
  };
  const name = Object.entries(factors)
    .filter(([k, v]) => k !== 'group' && !(k === 'ramp' && v === 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return {
    name: `${group}: ${name}`,
    group,
    params,
    // Pre-registered: nothing to read when there is no breathing, 3 px shake, or an in-band
    // flicker with a tiny amplitude; a cell is "good" when it is clean enough that abstaining
    // counts against the method.
    shouldAbstain: truth?.shouldAbstain ?? (A === 0 || shake >= 3 || (inBandFlicker && A <= 0.5)),
    good: truth?.good ?? (A >= 0.5 && shake <= 1 && !inBandFlicker),
    factors,
    keepAs,
  };
}

const CORE_RATES = [8, 12, 18, 24, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 48, 60, 80];
const CORE_AMPS = [0.3, 0.5, 1, 2, 4];
const CORE_SHAKES = [0, 0.5, 1, 3];

function coreCells(seeds: number[], fpsList: number[]): Cell[] {
  const out: Cell[] = [];
  for (const seed of seeds) {
    for (const fps of fpsList) {
      for (const bpm of CORE_RATES) {
        for (const amplitudePx of CORE_AMPS) {
          for (const shakeRmsPx of CORE_SHAKES) {
            out.push(cell('core', { seed, fps, bpm, amplitudePx, shakeRmsPx }));
          }
        }
      }
    }
  }
  return out;
}

function nuisanceCells(seeds: number[]): Cell[] {
  const variants: Partial<SceneParams>[] = [
    { contrast: 10 },
    { contrast: 40 },
    { flicker: { hz: 10, depth: 0.03 } },
    { flicker: { hz: 0.5, depth: 0.02 } },
    { flicker: { hz: 100, depth: 0.05 } },
    { purr: { hz: 25, amplitudePx: 0.3 } },
    { twitches: 2 },
    { fps: 24 },
    { fps: 60 },
    { rateRampBpm: 6 },
  ];
  const out: Cell[] = [];
  for (const variant of variants) {
    for (const seed of seeds) {
      for (const bpm of [18, 30, 36]) {
        out.push(
          cell('nuisance', { seed, fps: 30, bpm, amplitudePx: 1, shakeRmsPx: 0.5, ...variant }),
        );
      }
    }
  }
  return out;
}

function refusalCells(seeds: number[]): Cell[] {
  const out: Cell[] = [];
  for (const seed of seeds) {
    for (const contrast of [10, 20, 40]) {
      for (const shakeRmsPx of [0, 1]) {
        out.push(cell('refusal', { seed, fps: 30, bpm: 30, amplitudePx: 0, contrast, shakeRmsPx }));
      }
    }
    // The third registered refusal condition: in-band flicker over a tiny amplitude.
    for (const amplitudePx of [0.3, 0.5]) {
      out.push(
        cell('refusal', { seed, fps: 30, bpm: 30, amplitudePx, flicker: { hz: 0.5, depth: 0.02 } }),
      );
    }
  }
  return out;
}

function smokeCells(): Cell[] {
  const out: Cell[] = [];
  for (const bpm of [18, 30, 36]) {
    for (const amplitudePx of [0.5, 2]) {
      for (const shakeRmsPx of [0, 3]) {
        const keep =
          bpm === 30 && amplitudePx === 2 && shakeRmsPx === 0 ? 'smoke-30bpm.mp4' : undefined;
        out.push(
          cell('smoke', { seed: 1, fps: 30, bpm, amplitudePx, shakeRmsPx }, undefined, keep),
        );
      }
    }
  }
  out.push(cell('smoke', { seed: 1, fps: 30, bpm: 30, amplitudePx: 0 }));
  // A 25 Hz purr at 24 fps aliases to 1 Hz = 60 bpm, in band: neither good nor a must-abstain,
  // reported on its own (README, aliasing table).
  out.push(
    cell(
      'smoke',
      { seed: 1, fps: 24, bpm: 30, amplitudePx: 1, purr: { hz: 25, amplitudePx: 1 } },
      { shouldAbstain: false, good: false },
      'smoke-purr24.mp4',
    ),
  );
  return out;
}

/** The cells of a subset; `seeds` is how many seeds (1 … N) every seeded grid gets. */
export function sweepCells(subset: string, seeds: number): Cell[] {
  const seeded = Array.from({ length: seeds }, (_, i) => i + 1);
  switch (subset) {
    case 'smoke':
      return smokeCells();
    case 'core':
      return [...coreCells(seeded, [30]), ...nuisanceCells(seeded), ...refusalCells(seeded)];
    case 'full':
      return [
        ...coreCells([1, 2, 3], [24, 30, 60]),
        ...nuisanceCells(seeded),
        ...refusalCells(seeded),
      ];
    default:
      throw new UsageError(`unknown subset ${subset}: expected smoke, core or full`);
  }
}

function methodsFor(method: string): Method[] {
  switch (method) {
    case 'lk':
      return ['lk-edge', 'lk-interior'];
    case 'profile':
      return ['profile-edge'];
    case 'both':
      return ['lk-edge', 'lk-interior', 'profile-edge'];
    default:
      throw new UsageError(`unknown method ${method}: expected lk, profile or both`);
  }
}

function extract(
  method: Method,
  frames: Iterable<Frame>,
  scene: ReturnType<typeof makeScene>,
  fps: number,
): MotionSignal {
  const background = scene.background;
  switch (method) {
    case 'lk-edge':
      return lkMotion(frames, scene.roiEdge, fps, { background });
    case 'lk-interior':
      return lkMotion(frames, scene.roiInterior, fps, { background });
    case 'profile-edge':
      return profileMotion(frames, scene.roiEdge, fps, { background });
    default:
      throw new Error(`${method} is not a sweep method`);
  }
}

/** Non-overlapping 15/30/60 s windows from t = 0, estimated against the clip-wide quality. */
export function windowRows(
  cellName: string,
  method: Method,
  motion: MotionSignal,
  fps: number,
  truthBpm: (startS: number, seconds: number) => number,
  truth: { shouldAbstain: boolean; good: boolean },
): WindowResult[] {
  const rows: WindowResult[] = [];
  const clipSeconds = motion.signal.length / fps;
  for (const seconds of WINDOWS) {
    for (let startS = 0; startS + seconds <= clipSeconds + 1e-9; startS += seconds) {
      const slice = motion.signal.slice(
        Math.round(startS * fps),
        Math.round((startS + seconds) * fps),
      );
      const t = truthBpm(startS, seconds);
      rows.push({
        cell: cellName,
        method,
        startS,
        seconds,
        truthBpm: t,
        shouldAbstain: truth.shouldAbstain,
        // 15 s holds fewer than three cycles below 12 bpm: too-short by design, not a false abstain.
        // The truth is a summed phase, so 12 bpm can arrive as 12.000000000000032.
        good: truth.good && !(seconds === 15 && t <= 12 + 1e-9),
        result: estimate(slice, fps, motion.quality),
      });
    }
  }
  return rows;
}

async function runCell(c: Cell, methods: Method[], encode: boolean, outDir: string) {
  const scene = makeScene(c.params);
  const fps = c.params.fps;
  let frames: Frame[];
  if (encode) {
    const file = join(outDir, c.keepAs ?? 'encode-tmp.mp4');
    try {
      await writeClip(scene.frames(), file, { fps, ...SWEEP_SIZE });
      frames = await readFrames(file, { fps, ...SWEEP_SIZE });
    } finally {
      if (c.keepAs === undefined) rmSync(file, { force: true });
    }
  } else {
    frames = [...scene.frames()];
  }
  const rows: WindowResult[] = [];
  for (const method of methods) {
    const motion = extract(method, frames, scene, fps);
    rows.push(...windowRows(c.name, method, motion, fps, scene.truth.windowBpm, c));
  }
  return rows;
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function toolVersion(tool: string): string {
  try {
    return execFileSync(tool, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')[0];
  } catch {
    return 'not found';
  }
}

const fmt = (v: number | null, digits = 2) => (v === null ? 'n/a' : v.toFixed(digits));
const pct = (v: number | null) => (v === null ? 'n/a' : `${(100 * v).toFixed(1)} %`);

function summaryMarkdown(s: Summary): string {
  const lines = [
    `- Windows: ${s.windows}, accepted ${s.accepted}, abstained ${s.abstained} (${pct(s.abstainRate)})`,
    `- MAE: 15 s ${fmt(s.mae[15])}, 30 s ${fmt(s.mae[30])}, 60 s ${fmt(s.mae[60])} bpm`,
    `- Bias ${fmt(s.bias)} bpm, SD ${fmt(s.sd)}, limits of agreement ${
      s.loa === null ? 'n/a' : `${fmt(s.loa[0])} to ${fmt(s.loa[1])}`
    } bpm`,
    `- Within ±2: ${pct(s.within2)}; within ±4: ${pct(s.within4)}; under-count beyond −4: ${s.underBeyond4}`,
    `- Label agreement ${pct(s.labelAgreement)}; High → Normal ${s.highToNormal}`,
    `- Correct abstain ${pct(s.correctAbstain)}; false abstain (primary) ${pct(s.falseAbstain)}`,
    '',
    '| Quality bucket | Windows | Abstained |',
    '|---|---|---|',
    ...s.abstainByQuality.map((b) => `| ${b.bucket} | ${b.windows} | ${b.abstained} |`),
  ];
  return lines.join('\n');
}

async function synth(values: {
  subset: string;
  seeds: string;
  encode: boolean;
  method: string;
  out: string;
}): Promise<number> {
  const seeds = Number(values.seeds);
  if (!Number.isInteger(seeds) || seeds < 1)
    throw new UsageError(`--seeds must be a positive integer`);
  const cells = sweepCells(values.subset, seeds);
  const methods = methodsFor(values.method);
  const outDir = values.out;
  mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const rows: WindowResult[] = [];
  for (let i = 0; i < cells.length; i++) {
    const t0 = Date.now();
    rows.push(...(await runCell(cells[i], methods, values.encode, outDir)));
    process.stderr.write(
      `[${i + 1}/${cells.length}] ${cells[i].name} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`,
    );
  }
  const wallS = (Date.now() - started) / 1000;

  // The verdict is on the primary extractor; the profile method is a cross-check and is only
  // judged when it is the only method run.
  const primaryRows = rows.filter((r) => isPrimary(r.method));
  const judged = primaryRows.length > 0 ? primaryRows : rows;
  const summary = summarise(judged);
  const v = verdict(summary, SYNTHETIC_THRESHOLDS);
  const byCell = new Map(cells.map((c) => [c.name, c]));
  const factor = (name: string) => (r: WindowResult) => String(byCell.get(r.cell)!.factors[name]);
  const placement = (r: WindowResult) => (r.method === 'lk-interior' ? 'interior' : 'edge');
  const neither = rows.filter((r) => !r.shouldAbstain && !r.good);
  const breakdowns: Array<[string, (r: WindowResult) => string]> = [
    ['Method', (r) => r.method],
    ['ROI placement', placement],
    ['Window (s)', (r) => String(r.seconds)],
    ['Group', factor('group')],
    ['Amplitude (px)', factor('A')],
    ['Shake (px rms)', factor('shake')],
    ['Rate (bpm)', factor('bpm')],
    ['Contrast', factor('contrast')],
    ['Flicker', factor('flicker')],
    ['Purr', factor('purr')],
    ['Twitches', factor('twitches')],
    ['Rate ramp (bpm)', factor('ramp')],
    ['Frame rate', factor('fps')],
  ];
  const meta = {
    node: process.version,
    ffmpeg: values.encode ? toolVersion('ffmpeg') : null,
    commit: gitCommit(),
    date: new Date().toISOString(),
    subset: values.subset,
    seeds,
    encode: values.encode,
    cells: cells.length,
    methods,
    judged: primaryRows.length > 0 ? 'primary (lk-*)' : methods.join(', '),
    wallSeconds: Math.round(wallS),
  };
  const md = [
    `# Synthetic sweep: ${values.subset}`,
    '',
    `${meta.cells} cells × ${methods.length} methods × 7 windows = ${rows.length} windows; ` +
      `${values.encode ? 'encoded (libx264 CRF 28)' : 'in-process frames'}; ` +
      `Node ${meta.node}; ffmpeg ${meta.ffmpeg ?? 'not used'}; commit ${meta.commit}; ${meta.date}; ` +
      `${Math.round(wallS)} s wall.`,
    '',
    `## Verdict (${meta.judged}, ${judged.length} windows)`,
    '',
    verdictMarkdown(v),
    '',
    '## Summary',
    '',
    summaryMarkdown(summary),
    '',
    '## Breakdowns (all methods)',
    '',
    ...breakdowns.flatMap(([title, f]) => [
      `### By ${title}`,
      '',
      breakdownMarkdown(rows, f, title),
      '',
    ]),
    '## Cells that are neither good nor must-abstain',
    '',
    neither.length === 0
      ? 'None in this subset.'
      : [
          '| Cell | Method | Window | Truth | Read | Reasons |',
          '|---|---|---|---|---|---|',
          ...neither.map(
            (r) =>
              `| ${r.cell} | ${r.method} | ${r.startS}+${r.seconds} s | ${r.truthBpm.toFixed(1)} | ` +
              `${r.result.quantisedBpm ?? '—'} | ${r.result.reasons.join(', ') || '—'} |`,
          ),
        ].join('\n'),
    '',
  ].join('\n');
  writeFileSync(
    join(outDir, 'synthetic.json'),
    JSON.stringify({ meta, rows, summary, verdict: v }),
  );
  writeFileSync(join(outDir, 'synthetic.md'), md);
  console.log(
    `${cells.length} cells, ${rows.length} windows in ${Math.round(wallS)} s → ${outDir}`,
  );
  console.log(verdictMarkdown(v));
  return v.every((c) => c.pass) ? 0 : 1;
}

// ------------------------------------------------------------------ owner recordings

interface ClipOptions {
  roi?: string;
  background?: string;
  fps: string;
  size?: string;
  longest: string;
  window: string;
  method: string;
}

interface ClipWindow {
  start: number;
  seconds: number;
  method: 'lk' | 'profile';
  result: EstimateResult;
}

interface ClipAnalysis {
  clip: string;
  source: ProbeInfo;
  working: { width: number; height: number };
  fps: number;
  windowSeconds: number;
  roi: Roi;
  background: Roi;
  motions: Array<{ method: 'lk' | 'profile'; motion: MotionSignal }>;
  windows: ClipWindow[];
}

export function parseRoi(text: string | undefined, name: string): Roi | undefined {
  if (text === undefined) return undefined;
  const v = text.split(',').map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isInteger(n) || n < 0) || v[2] < 1 || v[3] < 1) {
    throw new UsageError(`--${name} must be x,y,w,h in whole working pixels, got "${text}"`);
  }
  return { x: v[0], y: v[1], w: v[2], h: v[3] };
}

function parseNumber(text: string, name: string, min: number): number {
  const v = Number(text);
  if (!Number.isFinite(v) || v < min) throw new UsageError(`--${name} must be a number ≥ ${min}`);
  return v;
}

function clipMethods(method: string): Array<'lk' | 'profile'> {
  switch (method) {
    case 'lk':
      return ['lk'];
    case 'profile':
      return ['profile'];
    case 'both':
      return ['lk', 'profile'];
    default:
      throw new UsageError(`unknown method ${method}: expected lk, profile or both`);
  }
}

/** Probes, decodes and estimates one recording; prints what it decided to stderr. */
async function analyseClip(
  clip: string,
  o: ClipOptions,
  dumpFrame?: string,
): Promise<ClipAnalysis> {
  const fps = parseNumber(o.fps, 'fps', 4);
  const windowSeconds = parseNumber(o.window, 'window', 10);
  const methods = clipMethods(o.method);
  if (o.roi === undefined) throw new UsageError('--roi x,y,w,h is required (working pixels)');
  // Both rectangles are parsed before the probe so a typo fails without touching the clip.
  const roi = parseRoi(o.roi, 'roi')!;
  const backgroundArg = parseRoi(o.background, 'background');
  const source = await probe(clip);
  let working: { width: number; height: number };
  if (o.size !== undefined) {
    const m = /^(\d+)x(\d+)$/.exec(o.size);
    if (m === null) throw new UsageError(`--size must be WxH, got "${o.size}"`);
    working = { width: Number(m[1]), height: Number(m[2]) };
  } else {
    working = workingSize(source, parseNumber(o.longest, 'longest', 16));
  }
  console.error(
    `working size ${working.width}x${working.height} (source ${source.width}x${source.height}, ` +
      `rotation ${source.rotation}, fps ${+source.fps.toFixed(3)})`,
  );
  // Any periodic motion within ±1.5 Hz of a multiple of the frame rate lands in the breathing
  // band: at 24 fps a 25 Hz purr reads as 60 bpm and nothing downstream can tell.
  for (const [what, value] of [
    ['source', source.fps],
    ['analysis', fps],
  ] as const) {
    if (value < MIN_DELIVERED_FPS) {
      console.error(
        `warning: ${what} frame rate ${+value.toFixed(3)} fps is below ${MIN_DELIVERED_FPS}: a 25 Hz purr aliases ` +
          'into the breathing band (24 fps → 60 bpm); record and analyse at 30 fps',
      );
    }
  }
  const background = backgroundArg ?? topStrip(working);
  for (const [name, r] of [
    ['roi', roi],
    ['background', background],
  ] as const) {
    if (r.x + r.w > working.width || r.y + r.h > working.height) {
      throw new UsageError(
        `--${name} ${r.x},${r.y},${r.w},${r.h} does not fit the ${working.width}x${working.height} working frame`,
      );
    }
  }
  const frames = await readFrames(clip, { fps, ...working });
  if (frames.length === 0) throw new Error('ffmpeg decoded no frames');
  if (dumpFrame !== undefined) writeFileSync(dumpFrame, writePgm(frames[0]));
  console.error(
    `${frames.length} frames (${(frames.length / fps).toFixed(1)} s) at ${fps} fps, ` +
      `ROI ${roi.x},${roi.y},${roi.w},${roi.h}, background ${background.x},${background.y},${background.w},${background.h}`,
  );
  const motions: ClipAnalysis['motions'] = [];
  for (const method of methods) {
    if (method === 'lk') {
      const motion = lkMotion(frames, roi, fps, { background });
      if (motion.backgroundValidRatio === 0) {
        console.error(
          'warning: background strip has no texture; pass --background on static scene',
        );
      }
      motions.push({ method, motion });
    } else {
      motions.push({ method, motion: profileMotion(frames, roi, fps, { background }) });
    }
  }
  const windows: ClipWindow[] = [];
  const clipSeconds = frames.length / fps;
  for (const { method, motion } of motions) {
    for (let start = 0; start + windowSeconds <= clipSeconds + 1e-9; start += windowSeconds) {
      const slice = motion.signal.slice(
        Math.round(start * fps),
        Math.round((start + windowSeconds) * fps),
      );
      windows.push({
        start,
        seconds: windowSeconds,
        method,
        result: estimate(slice, fps, motion.quality),
      });
    }
  }
  return { clip, source, working, fps, windowSeconds, roi, background, motions, windows };
}

const interval = (r: EstimateResult) =>
  r.interval === null ? '—' : `${r.interval[0]}–${r.interval[1]}`;
const reasons = (r: EstimateResult) => (r.reasons.length === 0 ? '—' : r.reasons.join(', '));
const num = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));

function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [line(header), ...rows.map(line)].join('\n');
}

async function analyse(
  clip: string | undefined,
  values: ClipOptions & { dump?: string; 'dump-frame'?: string; json: boolean },
): Promise<number> {
  if (clip === undefined) throw new UsageError('analyse needs a clip');
  const a = await analyseClip(clip, values, values['dump-frame']);
  if (values.dump !== undefined) {
    const lines = ['t,method,signal,filtered'];
    for (const { method, motion } of a.motions) {
      const filtered = bandpass(linearDetrend(motion.signal), a.fps);
      motion.signal.forEach((v, i) => {
        lines.push(`${(i / a.fps).toFixed(4)},${method},${v.toFixed(5)},${filtered[i].toFixed(5)}`);
      });
    }
    writeFileSync(values.dump, lines.join('\n') + '\n');
  }
  if (values.json) {
    const { motions: _motions, ...rest } = a;
    console.log(JSON.stringify(rest, null, 2));
    return 0;
  }
  console.log(
    table(
      [
        'start',
        's',
        'method',
        'bpm',
        'quantised',
        'interval',
        'quality',
        'reasons',
        'fft/acf/ibi/count',
      ],
      a.windows.map(({ start, seconds, method, result: r }) => [
        String(start),
        String(seconds),
        method,
        num(r.rawBpm),
        num(r.quantisedBpm, 0),
        interval(r),
        r.quality.toFixed(2),
        reasons(r),
        `${num(r.estimators.fft)}/${num(r.estimators.acf)}/${num(r.estimators.ibi)}/${r.estimators.count}`,
      ]),
    ),
  );
  return 0;
}

/**
 * windowTruth has no truth for a single counter, so one counter would score every window as
 * discarded and print an all-FAIL verdict; say what is missing instead.
 */
export function requireTwoCounters(sidecar: Map<string, number[]>): void {
  if (sidecar.size >= 2) return;
  throw new UsageError(
    `sidecar has only one counter (${[...sidecar.keys()].join(', ')}); ` +
      'two independent counters are required',
  );
}

async function score(
  clip: string | undefined,
  values: ClipOptions & {
    truth?: string;
    ceilings: string;
    degraded: boolean;
    json?: string;
    md?: string;
  },
): Promise<number> {
  if (clip === undefined) throw new UsageError('score needs a clip');
  if (values.truth === undefined) throw new UsageError('--truth <sidecar.csv> is required');
  const windowSeconds = Number(values.window);
  if (![15, 30, 60].includes(windowSeconds)) throw new UsageError('--window must be 15, 30 or 60');
  const c = values.ceilings.split(',').map(Number);
  if (c.length !== 2 || c.some((v) => !Number.isInteger(v) || v < 1) || c[0] >= c[1]) {
    throw new UsageError(`--ceilings must be normal,elevated whole bpm, got "${values.ceilings}"`);
  }
  const ceilings = { normal: c[0], elevated: c[1] };
  const pet = { normalCeiling: ceilings.normal, elevatedCeiling: ceilings.elevated };
  const sidecar = parseSidecar(readFileSync(values.truth, 'utf8'), clip);
  if (sidecar.size === 0) throw new Error(`${values.truth} has no rows for ${clip}`);
  requireTwoCounters(sidecar);
  const a = await analyseClip(clip, values);
  const rows: WindowResult[] = [];
  const discarded: string[][] = [];
  const tableRows: string[][] = [];
  for (const w of a.windows) {
    const truth = windowTruth(sidecar, w.start, w.seconds);
    const r = w.result;
    if (truth.bpm === null) {
      discarded.push([
        String(w.start),
        w.method,
        String(truth.counters),
        String(truth.disagreement),
      ]);
      continue;
    }
    rows.push({
      cell: clip,
      method: w.method,
      startS: w.start,
      seconds: windowSeconds as WindowSeconds,
      truthBpm: truth.bpm,
      shouldAbstain: values.degraded,
      good: !values.degraded,
      result: r,
    });
    tableRows.push([
      String(w.start),
      w.method,
      truth.bpm.toFixed(1),
      num(r.quantisedBpm, 0),
      r.quantisedBpm === null ? '—' : (r.quantisedBpm - truth.bpm).toFixed(1),
      getRateStatus(Math.round(truth.bpm), pet).label,
      r.quantisedBpm === null ? '—' : getRateStatus(r.quantisedBpm, pet).label,
      r.quality.toFixed(2),
      reasons(r),
    ]);
  }
  const primary = rows.filter((r) => isPrimary(r.method));
  const judged = primary.length > 0 ? primary : rows;
  const summary = summarise(judged, ceilings);
  const v = verdict(summary, REAL_THRESHOLDS);
  // A good clip has no window that should abstain and a degraded one no good window: those
  // criteria are undecided for this clip (—), and decided over all clips (README §8).
  const clipVerdict = verdictMarkdown(v, '—');
  const windowTable = table(
    [
      'start',
      'method',
      'manual',
      'camera',
      'error',
      'label manual',
      'label camera',
      'quality',
      'reasons',
    ],
    tableRows,
  );
  const discardedTable =
    discarded.length === 0
      ? 'No window discarded.'
      : table(['start', 'method', 'counters', 'disagreement (breaths)'], discarded);
  const md = [
    `# ${clip}`,
    '',
    `Windows of ${windowSeconds} s; ceilings ${ceilings.normal}/${ceilings.elevated}; ` +
      `${values.degraded ? 'degraded clip (should abstain)' : 'good clip'}; judged on ${
        primary.length > 0 ? 'lk' : 'profile'
      }.`,
    '',
    '## Verdict (real-recording thresholds, this clip only; — = nothing to judge here)',
    '',
    clipVerdict,
    '',
    '## Windows',
    '',
    '```',
    windowTable,
    '```',
    '',
    '## Discarded windows (no agreed manual count)',
    '',
    '```',
    discardedTable,
    '```',
    '',
  ].join('\n');
  if (values.json !== undefined) {
    writeFileSync(
      values.json,
      JSON.stringify({
        clip,
        source: a.source,
        working: a.working,
        ceilings,
        degraded: values.degraded,
        rows,
        summary,
        verdict: v,
      }),
    );
  }
  if (values.md !== undefined) writeFileSync(values.md, md);
  console.log(windowTable);
  console.log(`\nDiscarded:\n${discardedTable}\n`);
  console.log(clipVerdict);
  return 0;
}

// ------------------------------------------------------------------ entry point

const CLIP_OPTIONS = {
  roi: { type: 'string' },
  background: { type: 'string' },
  fps: { type: 'string', default: '30' },
  size: { type: 'string' },
  longest: { type: 'string', default: '320' },
  window: { type: 'string', default: '30' },
  method: { type: 'string', default: 'both' },
} as const;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'synth': {
      const { values } = parseArgs({
        args: rest,
        strict: true,
        options: {
          subset: { type: 'string', default: 'core' },
          seeds: { type: 'string', default: '1' },
          encode: { type: 'boolean', default: false },
          method: { type: 'string', default: 'both' },
          out: { type: 'string', default: DEFAULT_OUT },
        },
      });
      return synth(values);
    }
    case 'analyse': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          ...CLIP_OPTIONS,
          dump: { type: 'string' },
          'dump-frame': { type: 'string' },
          json: { type: 'boolean', default: false },
        },
      });
      return analyse(positionals[0], values);
    }
    case 'score': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: true,
        options: {
          ...CLIP_OPTIONS,
          truth: { type: 'string' },
          ceilings: {
            type: 'string',
            default: `${DEFAULT_CEILINGS.normal},${DEFAULT_CEILINGS.elevated}`,
          },
          degraded: { type: 'boolean', default: false },
          json: { type: 'string' },
          md: { type: 'string' },
        },
      });
      return score(positionals[0], values);
    }
    default:
      throw new UsageError(
        command === undefined ? 'missing command' : `unknown command ${command}`,
      );
  }
}

/** main() with every error turned into a message on stderr and an exit code: 2 usage, 1 other. */
export async function cli(argv: string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (err: unknown) {
    const usage =
      err instanceof UsageError ||
      (err instanceof Error && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'));
    if (usage) {
      console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
      return 2;
    }
    const hint = ffmpegMissingHint(err);
    // An error with a code has already said what went wrong: a tool's non-zero exit follows
    // its own stderr (passed through), a file-system error names the file. Only an error
    // nothing anticipated gets its stack.
    const expected = err instanceof Error && 'code' in err;
    const text = !(err instanceof Error)
      ? String(err)
      : expected
        ? err.message
        : (err.stack ?? err.message);
    console.error(hint ?? text);
    return 1;
  }
}

// Only the command line runs the CLI: the tests import this file for its helpers.
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  // exitCode, not exit(): on Windows a piped stdout is asynchronous and exit() would cut the
  // --json output short. Nothing keeps the loop alive once the command has settled.
  cli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
