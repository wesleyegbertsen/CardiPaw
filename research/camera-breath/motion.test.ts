import { describe, expect, it } from 'vitest';
import { estimate } from './estimate.ts';
import { colProfile, profileMotion, profileShift, rowProfile, topStrip } from './motion.ts';
import type { Frame, Roi } from './motion.ts';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// A padded texture that frames are cut from, so a frame can be shifted by up to PAD pixels
// in either direction without running off the edge.
const PAD = 64;
interface Texture {
  width: number;
  height: number;
  data: Float32Array;
}

/** Three-octave value noise around `level`, scaled to the given standard deviation. */
function valueNoise(seed: number, width: number, height: number, level: number, std: number) {
  const next = lcg(seed);
  const data = new Float32Array(width * height);
  for (const [spacing, amp] of [
    [8, 1],
    [4, 0.5],
    [2, 0.25],
  ]) {
    const lw = Math.ceil(width / spacing) + 2;
    const lh = Math.ceil(height / spacing) + 2;
    const lattice = Float32Array.from({ length: lw * lh }, () => next() - 0.5);
    for (let y = 0; y < height; y++) {
      const fy = y / spacing;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      for (let x = 0; x < width; x++) {
        const fx = x / spacing;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const i = y0 * lw + x0;
        const top = lattice[i] * (1 - tx) + lattice[i + 1] * tx;
        const bottom = lattice[i + lw] * (1 - tx) + lattice[i + lw + 1] * tx;
        data[y * width + x] += amp * (top * (1 - ty) + bottom * ty);
      }
    }
  }
  let m = 0;
  for (const v of data) m += v;
  m /= data.length;
  let s = 0;
  for (const v of data) s += (v - m) ** 2;
  s = Math.sqrt(s / data.length);
  for (let i = 0; i < data.length; i++) data[i] = level + (std * (data[i] - m)) / s;
  return { width, height, data } as Texture;
}

function texture(seed: number, width: number, height: number, std = 30): Texture {
  return valueNoise(seed, width + 2 * PAD, height + 2 * PAD, 128, std);
}

/** The w×h frame whose content is `tex` moved by (dx, dy), sampled bilinearly. */
function shiftFrame(tex: Texture, w: number, h: number, dx: number, dy: number): Frame {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - dx + PAD;
      const sy = y - dy + PAD;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * tex.width + x0;
      const v =
        (tex.data[i] * (1 - fx) + tex.data[i + 1] * fx) * (1 - fy) +
        (tex.data[i + tex.width] * (1 - fx) + tex.data[i + tex.width + 1] * fx) * fy;
      data[y * w + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { width: w, height: h, data };
}

/** Pastes `src` into `dst` where `roi` is, in place. */
function paste(dst: Frame, src: Frame, roi: Roi): Frame {
  for (let y = roi.y; y < roi.y + roi.h; y++) {
    for (let x = roi.x; x < roi.x + roi.w; x++) {
      dst.data[y * dst.width + x] = src.data[y * src.width + x];
    }
  }
  return dst;
}

const FULL: Roi = { x: 0, y: 0, w: 64, h: 64 };
const sin = (bpm: number, t: number) => Math.sin((2 * Math.PI * bpm * t) / 60);

describe('profileShift', () => {
  const tex = texture(1, 64, 64);
  const ref = rowProfile(shiftFrame(tex, 64, 64, 0, 0), FULL);

  it.each([1.3, -0.4])('recovers %s px within 0.1', (dy) => {
    const cur = rowProfile(shiftFrame(tex, 64, 64, 0, dy), FULL);
    expect(Math.abs(profileShift(ref, cur).shift - dy)).toBeLessThan(0.1);
  });

  it('recovers a 0.5 px shift of a noisy step edge within 0.15', () => {
    // A single edge (lighter wall above a darker flank) with pixel noise of σ 4.
    const step: Texture = { width: 64 + 2 * PAD, height: 64 + 2 * PAD, data: new Float32Array() };
    const next = lcg(5);
    step.data = Float32Array.from({ length: step.width * step.height }, (_, i) => {
      const y = Math.floor(i / step.width) - PAD;
      const noise = 4 * (next() + next() + next() - 1.5) * 2;
      return (y < 32 ? 140 : 110) + noise;
    });
    const a = rowProfile(shiftFrame(step, 64, 64, 0, 0), FULL);
    const b = rowProfile(shiftFrame(step, 64, 64, 0, 0.5), FULL);
    expect(Math.abs(profileShift(a, b).shift - 0.5)).toBeLessThan(0.15);
  });

  it('score drops below 0.3 on uncorrelated profiles', () => {
    const other = rowProfile(shiftFrame(texture(2, 64, 64), 64, 64, 0, 0), FULL);
    expect(profileShift(ref, other).score).toBeLessThan(0.3);
    expect(profileShift(ref, ref).score).toBeCloseTo(1, 6);
  });
});

describe('profiles', () => {
  it('have zero mean and unit std, and a constant ROI gives zeros', () => {
    const frame = shiftFrame(texture(3, 64, 64), 64, 64, 0, 0);
    for (const p of [rowProfile(frame, FULL), colProfile(frame, FULL)]) {
      let m = 0;
      for (const v of p) m += v;
      let s = 0;
      for (const v of p) s += v * v;
      expect(m / p.length).toBeCloseTo(0, 9);
      expect(Math.sqrt(s / p.length)).toBeCloseTo(1, 9);
    }
    const flat: Frame = { width: 8, height: 8, data: new Uint8Array(64).fill(77) };
    expect(Array.from(rowProfile(flat, { x: 0, y: 0, w: 8, h: 8 }))).toEqual(new Array(8).fill(0));
  });

  it('topStrip is the top rows, capped at the frame height', () => {
    expect(topStrip({ width: 192, height: 144 })).toEqual({ x: 0, y: 0, w: 192, h: 40 });
    expect(topStrip({ width: 64, height: 24 })).toEqual({ x: 0, y: 0, w: 64, h: 24 });
  });
});

describe('profileMotion', () => {
  // 64×96 frames: the top 40 rows are the static background strip, the body sits below.
  const W = 64;
  const H = 96;
  const BODY: Roi = { x: 0, y: 48, w: W, h: 40 };
  const FPS = 24;

  it('subtracts a sinusoidal 24 bpm global shift: ROI 2·sin(24 bpm) + 1·sin(30 bpm) reads 30 through estimate()', () => {
    const wall = texture(10, W, H);
    const body = texture(11, W, H);
    function* frames() {
      for (let i = 0; i < 20 * FPS; i++) {
        const t = i / FPS;
        const global = 2 * sin(24, t);
        const frame = shiftFrame(wall, W, H, 0, global);
        yield paste(frame, shiftFrame(body, W, H, 0, global + sin(30, t)), BODY);
      }
    }
    const m = profileMotion(frames(), BODY, FPS);
    // The 2 px global motion is real shake and is reported as such (borderRms ≈ 1.36, above the
    // 1.2 px gate); the estimate is read without that quality to test the subtraction alone.
    expect(m.quality.borderRms).toBeGreaterThan(1);
    const r = estimate(m.signal, FPS);
    expect(r.bpm).not.toBeNull();
    expect(Math.abs(r.bpm! - 30)).toBeLessThan(1);
  });

  it('borderRms stays below 0.15 px on a shake-free scene whose body spans the full width', () => {
    // The lower half of the frame moves 2 px: a background strip made of those rows would read
    // ≈ 1.2 px, while the static top rows read exactly 0.
    const wall = texture(12, W, H);
    const body = texture(13, W, H);
    const lower: Roi = { x: 0, y: 48, w: W, h: H - 48 };
    function* frames() {
      for (let i = 0; i < 15 * FPS; i++) {
        yield paste(
          shiftFrame(wall, W, H, 0, 0),
          shiftFrame(body, W, H, 0, 2 * sin(30, i / FPS)),
          lower,
        );
      }
    }
    const m = profileMotion(frames(), lower, FPS);
    expect(m.quality.borderRms).toBeLessThan(0.15);
    expect(m.quality.amplitudePx).toBeGreaterThan(1);
  });

  it('re-anchoring keeps a 20 s ramp continuous', () => {
    const tex = texture(14, W, H);
    const n = 20 * FPS;
    function* frames() {
      for (let i = 0; i < n; i++) yield shiftFrame(tex, W, H, 0, 0.1 * i);
    }
    const m = profileMotion(frames(), BODY, FPS, { background: null });
    expect(m.signal.length).toBe(n);
    expect(Math.abs(m.signal[n - 1] - 0.1 * (n - 1))).toBeLessThan(0.5);
    expect(m.quality.borderRms).toBe(0);
  });
});
