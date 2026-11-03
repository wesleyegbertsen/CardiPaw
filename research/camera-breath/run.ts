// Command-line front end of the camera-breath research prototype (#130). Runs on Node 24
// (type stripping, no build step) and needs ffmpeg 8 (ffmpeg and ffprobe) on PATH for
// anything that touches a video file. Nothing here is bundled into the app.
// Usage:
//   node research/camera-breath/run.ts synth [--subset smoke|core|full] [--seeds N] [--encode]
//       [--method lk|profile|both] [--out research/camera-breath/out]
//     Renders the synthetic sweep, scores it against the pre-registered thresholds, writes
//     out/synthetic.{json,md} and exits 1 when any criterion fails. --encode round-trips every
//     cell through libx264 (CRF 28) first. Never run by vitest or CI: core takes ~20 minutes.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { estimate } from './estimate.ts';
import { ffmpegMissingHint, readFrames, writeClip } from './ingest.ts';
import { lkMotion, profileMotion } from './motion.ts';
import type { Frame, MotionSignal } from './motion.ts';
import {
  SYNTHETIC_THRESHOLDS,
  breakdownMarkdown,
  isPrimary,
  summarise,
  verdict,
  verdictMarkdown,
} from './score.ts';
import type { Method, Summary, WindowResult, WindowSeconds } from './score.ts';
import { makeScene } from './synth.ts';
import type { SceneParams } from './synth.ts';

const USAGE = `Usage:
  node research/camera-breath/run.ts synth [--subset smoke|core|full] [--seeds N] [--encode]
      [--method lk|profile|both] [--out <dir>]
Needs ffmpeg 8 on PATH for --encode. See research/camera-breath/README.md.`;

const DEFAULT_OUT = fileURLToPath(new URL('./out', import.meta.url));
const WINDOWS: readonly WindowSeconds[] = [15, 30, 60];
const CLIP_SECONDS = 60;
const SWEEP_SIZE = { width: 192, height: 144 }; // what the gates were calibrated on

class UsageError extends Error {}

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
    .filter(([k, v]) => k !== 'group' && v !== factors.group && !(k === 'ramp' && v === 0))
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

function sweepCells(subset: string, seeds: number): Cell[] {
  const seeded = Array.from({ length: seeds }, (_, i) => i + 1);
  switch (subset) {
    case 'smoke':
      return smokeCells();
    case 'core':
      return [...coreCells([1], [30]), ...nuisanceCells(seeded), ...refusalCells(seeded)];
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
  }
}

/** Non-overlapping 15/30/60 s windows from t = 0, estimated against the clip-wide quality. */
function windowRows(
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
        good: truth.good && !(seconds === 15 && t <= 12),
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
    await writeClip(scene.frames(), file, { fps, ...SWEEP_SIZE });
    frames = await readFrames(file, { fps, ...SWEEP_SIZE });
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

// ------------------------------------------------------------------ entry point

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      subset: { type: 'string', default: 'core' },
      seeds: { type: 'string', default: '5' },
      encode: { type: 'boolean', default: false },
      method: { type: 'string', default: 'both' },
      out: { type: 'string', default: DEFAULT_OUT },
    },
  });
  const [command] = positionals;
  switch (command) {
    case 'synth':
      return synth(values);
    default:
      throw new UsageError(
        command === undefined ? 'missing command' : `unknown command ${command}`,
      );
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    const usage =
      err instanceof UsageError ||
      (err instanceof Error && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'));
    if (usage) {
      console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
      process.exit(2);
    }
    const hint = ffmpegMissingHint(err);
    console.error(hint ?? (err instanceof Error ? (err.stack ?? err.message) : String(err)));
    process.exit(1);
  },
);
