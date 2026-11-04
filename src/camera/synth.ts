// Seeded synthetic chest-motion scenes with ground truth, for the sweep and the unit tests.
// Pure module: ES2020 only, no Node built-ins. The renderer is the one the gate thresholds were
// calibrated on (README §2), so its arithmetic is kept as is.

import type { Frame, Roi } from './motion.ts';
import { topStrip } from './motion.ts';

export interface SceneParams {
  seed: number;
  width?: number; // default 192
  height?: number; // default 144
  fps: number;
  seconds: number;
  bpm: number;
  amplitudePx: number; // 0: no breathing
  contrast: number; // texture std, grey levels
  noiseSigma?: number; // pixel noise σ, default 4
  driftPxPerFrame?: number; // random-walk step, default 0.02
  shakeRmsPx?: number; // camera shake, default 0
  flicker?: { hz: number; depth: number } | null; // whole-frame multiplicative 1 + depth·sin
  purr?: { hz: number; amplitudePx: number } | null; // added to the body displacement
  twitches?: number; // +15 px body jumps of 0.3 s at seeded times in [1, seconds − 1]
  rateRampBpm?: number; // rate rises linearly by this much over the clip, default 0
  edgeStep?: number; // background level above the body, default 30
  bodyLevel?: number; // default 110
}

export interface SceneTruth {
  inhaleOnsetsS: number[];
  displacementPx: Float64Array; // body displacement per frame: breathing + purr + twitches
  windowBpm(startS: number, seconds: number): number;
}

/** Linear congruential generator (Numerical Recipes constants), uniform in [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function gaussianOf(next: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
}

/** Fast per-pixel Gaussian: a 65,536-entry table indexed by the LCG's top 16 bits. */
function fastGaussianOf(seed: number): () => number {
  const g = gaussianOf(lcg(seed ^ 0x9e3779b9));
  const table = new Float32Array(65536);
  for (let i = 0; i < table.length; i++) table[i] = g();
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return table[s >>> 16];
  };
}

/** One inhale–exhale cycle: a 40 % rising half-cosine (0 → 1), then a 60 % falling one. */
export function breathWaveform(phase01: number): number {
  return phase01 < 0.4
    ? 0.5 - 0.5 * Math.cos((Math.PI * phase01) / 0.4)
    : 0.5 + 0.5 * Math.cos((Math.PI * (phase01 - 0.4)) / 0.6);
}

const OCTAVES: ReadonlyArray<readonly [number, number]> = [
  [8, 1],
  [4, 0.5],
  [2, 0.25],
];

/** Three-octave value noise (lattice 8/4/2 px) scaled to `contrast` std around `level`. */
function texture(
  next: () => number,
  w: number,
  h: number,
  level: number,
  contrast: number,
): Float32Array {
  const out = new Float32Array(w * h);
  for (const [spacing, amp] of OCTAVES) {
    const lw = Math.ceil(w / spacing) + 2;
    const lh = Math.ceil(h / spacing) + 2;
    const lattice = new Float32Array(lw * lh);
    for (let i = 0; i < lattice.length; i++) lattice[i] = next() - 0.5;
    for (let y = 0; y < h; y++) {
      const fy = y / spacing;
      const y0 = fy | 0;
      const ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = x / spacing;
        const x0 = fx | 0;
        const tx = fx - x0;
        const i = y0 * lw + x0;
        const top = lattice[i] * (1 - tx) + lattice[i + 1] * tx;
        const bottom = lattice[i + lw] * (1 - tx) + lattice[i + lw + 1] * tx;
        out[y * w + x] += amp * (top * (1 - ty) + bottom * ty);
      }
    }
  }
  let m = 0;
  for (const v of out) m += v;
  m /= out.length;
  let s = 0;
  for (const v of out) s += (v - m) ** 2;
  s = Math.sqrt(s / out.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = level + (contrast === 0 ? 0 : (contrast * (out[i] - m)) / s);
  }
  return out;
}

function sampleBilinear(tex: Float32Array, tw: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * tw + x0;
  return (
    (tex[i] * (1 - fx) + tex[i + 1] * fx) * (1 - fy) +
    (tex[i + tw] * (1 - fx) + tex[i + tw + 1] * fx) * fy
  );
}

/** Hand shake: four octaves of interpolated lattice noise over time, scaled to `rms` px. */
function shakeSeries(next: () => number, n: number, rms: number): Float64Array {
  const out = new Float64Array(n);
  if (rms === 0) return out;
  for (let o = 0; o < 4; o++) {
    const spacing = 4 * 2 ** o;
    const amp = 2 ** o;
    const lattice = new Float64Array(Math.ceil(n / spacing) + 2);
    for (let i = 0; i < lattice.length; i++) lattice[i] = next() - 0.5;
    for (let i = 0; i < n; i++) {
      const f = i / spacing;
      const i0 = f | 0;
      const t = f - i0;
      out[i] += amp * (lattice[i0] * (1 - t) + lattice[i0 + 1] * t);
    }
  }
  let m = 0;
  for (const v of out) m += v;
  m /= n;
  let s = 0;
  for (const v of out) s += (v - m) ** 2;
  s = Math.sqrt(s / n);
  for (let i = 0; i < n; i++) out[i] = ((out[i] - m) / s) * rms;
  return out;
}

/** Texture padding on each side, px: shake, drift and twitches must stay within it. */
export const PAD = 24;

/**
 * A lateral view of a breathing flank: textured body below a horizontal edge, textured wall
 * above it. Inhaling raises the edge (and the body with it) by amplitudePx · breathWaveform.
 * Everything is seeded, so a scene renders byte-identically on every run.
 */
export function makeScene(p: SceneParams): {
  frames: () => Generator<Frame>;
  truth: SceneTruth;
  roiEdge: Roi;
  roiInterior: Roi;
  background: Roi;
} {
  const {
    seed,
    width: W = 192,
    height: H = 144,
    fps,
    seconds,
    bpm,
    amplitudePx: A,
    contrast,
    noiseSigma = 4,
    driftPxPerFrame = 0.02,
    shakeRmsPx = 0,
    flicker = null,
    purr = null,
    twitches = 0,
    rateRampBpm = 0,
    edgeStep = 30,
    bodyLevel = 110,
  } = p;
  const next = lcg(seed);
  const gauss = gaussianOf(next);
  const pixelNoise = fastGaussianOf(seed * 7919 + 13);
  const TW = W + 2 * PAD;
  const TH = H + 2 * PAD;
  const body = texture(next, TW, TH, bodyLevel, contrast);
  const wall = texture(next, TW, TH, bodyLevel + edgeStep, contrast);
  const n = Math.round(seconds * fps);

  const sx = shakeSeries(next, n, shakeRmsPx);
  const sy = shakeSeries(next, n, shakeRmsPx);
  let wx = 0;
  let wy = 0;
  for (let i = 0; i < n; i++) {
    wx += gauss() * driftPxPerFrame;
    wy += gauss() * driftPxPerFrame;
    sx[i] += wx;
    sy[i] += wy;
  }

  // cumulative[k] is the phase (in cycles) at the instant k / fps, k = 0 … n; frame i is
  // rendered with the phase at the end of its interval, cumulative[i + 1].
  const cumulative = new Float64Array(n + 1);
  const inhaleOnsetsS: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = cumulative[i];
    const ph = prev + (bpm + (rateRampBpm * i) / n) / 60 / fps;
    if (Math.floor(ph) > Math.floor(prev)) inhaleOnsetsS.push(i / fps);
    cumulative[i + 1] = ph;
  }
  const twitchAtS: number[] = [];
  for (let k = 0; k < twitches; k++) twitchAtS.push(1 + next() * (seconds - 2));

  const displacementPx = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    let d = A * breathWaveform(cumulative[i + 1] % 1);
    if (purr) d += purr.amplitudePx * Math.sin(2 * Math.PI * purr.hz * t);
    for (const tw of twitchAtS) if (t >= tw && t < tw + 0.3) d += 15;
    displacementPx[i] = d;
  }

  const edgeY = H / 2;
  function render(i: number): Frame {
    const t = i / fps;
    const d = displacementPx[i];
    const flick = flicker ? 1 + flicker.depth * Math.sin(2 * Math.PI * flicker.hz * t) : 1;
    const edge = edgeY - d; // inhale: the edge rises (smaller y)
    const ox = sx[i] + PAD;
    const oy = sy[i] + PAD;
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const Y = y + oy;
      const rowIsBody = Y - PAD >= edge; // scene row before the shake offset
      const yBody = Y + d;
      for (let x = 0; x < W; x++) {
        const X = x + ox;
        const v = rowIsBody ? sampleBilinear(body, TW, X, yBody) : sampleBilinear(wall, TW, X, Y);
        const o = v * flick + noiseSigma * pixelNoise();
        data[y * W + x] = o < 0 ? 0 : o > 255 ? 255 : o;
      }
    }
    return { width: W, height: H, data };
  }

  /** Phase at the exact instant: linear between frame instants, the end rate beyond the last. */
  function phaseAt(timeS: number): number {
    const f = timeS * fps;
    const k = Math.min(n - 1, Math.max(0, Math.floor(f)));
    return cumulative[k] + (f - k) * (cumulative[k + 1] - cumulative[k]);
  }
  const truth: SceneTruth = {
    inhaleOnsetsS,
    displacementPx,
    windowBpm: (startS, windowS) => ((phaseAt(startS + windowS) - phaseAt(startS)) * 60) / windowS,
  };
  return {
    frames: function* () {
      for (let i = 0; i < n; i++) yield render(i);
    },
    truth,
    // The edge never drops below H/2 − A − 15, so the interior ROI stays on the body for A ≤ 4.
    roiEdge: {
      x: Math.round(W / 4),
      y: Math.round(H / 6),
      w: Math.round(W / 2),
      h: Math.round((2 * H) / 3),
    },
    roiInterior: {
      x: Math.round(W / 4),
      y: Math.round(H / 2 + 12),
      w: Math.round(W / 2),
      h: Math.round(H / 2 - 20),
    },
    // 40 rows at 192×144 (what the gates were calibrated on), scaled with the frame so the strip
    // stays clear of the edge at H/2 on smaller fixtures.
    background: topStrip({ width: W, height: H }, Math.round((H * 40) / 144)),
  };
}
