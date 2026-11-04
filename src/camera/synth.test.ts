import { describe, expect, it } from 'vitest';
import { estimate } from './estimate.ts';
import { profileMotion } from './motion.ts';
import type { Frame, Roi } from './motion.ts';
import { breathWaveform, lcg, makeScene } from './synth.ts';
import type { SceneParams } from './synth.ts';

const BASE: SceneParams = {
  seed: 1,
  width: 96,
  height: 72,
  fps: 24,
  seconds: 5,
  bpm: 30,
  amplitudePx: 2,
  contrast: 40,
};

function take(frames: Iterable<Frame>, count: number): Frame[] {
  const out: Frame[] = [];
  for (const f of frames) {
    out.push(f);
    if (out.length === count) break;
  }
  return out;
}

/** Sub-pixel row of the horizontal edge: the gradient-weighted centroid of the row means. */
function edgeRow(frame: Frame): number {
  const means = new Float64Array(frame.height);
  for (let y = 0; y < frame.height; y++) {
    let sum = 0;
    for (let x = 0; x < frame.width; x++) sum += frame.data[y * frame.width + x];
    means[y] = sum / frame.width;
  }
  let weight = 0;
  let moment = 0;
  for (let y = 1; y < frame.height; y++) {
    const g = Math.abs(means[y] - means[y - 1]);
    weight += g;
    moment += g * (y - 0.5);
  }
  return moment / weight;
}

function meanAbsDiff(a: Frame, b: Frame): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}

describe('makeScene determinism', () => {
  it('same seed renders byte-identical frames', () => {
    const a = take(makeScene(BASE).frames(), 10);
    const b = take(makeScene(BASE).frames(), 10);
    for (let i = 0; i < 10; i++) expect(a[i].data).toEqual(b[i].data);
    expect(a[0].data).not.toBe(a[1].data); // each frame has its own buffer
  });

  it('different seeds differ', () => {
    const a = take(makeScene(BASE).frames(), 1)[0];
    const b = take(makeScene({ ...BASE, seed: 2 }).frames(), 1)[0];
    expect(meanAbsDiff(a, b)).toBeGreaterThan(5);
  });

  it('lcg is deterministic and uniform in [0, 1)', () => {
    const a = lcg(7);
    const b = lcg(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('makeScene motion', () => {
  it('amplitude 0 renders a static body apart from noise', () => {
    const frames = take(makeScene({ ...BASE, amplitudePx: 0 }).frames(), 30);
    for (let i = 1; i < 30; i++) expect(meanAbsDiff(frames[0], frames[i])).toBeLessThan(8);
  });

  it('the edge moves by amplitudePx between inhale peak and exhale trough', () => {
    // A flat scene shows the edge as a clean step; a textured one carries the sub-pixel motion.
    const params = { ...BASE, amplitudePx: 4, noiseSigma: 0, driftPxPerFrame: 0 };
    const scene = makeScene({ ...params, contrast: 0 });
    const frames = take(scene.frames(), 5 * 24);
    const textured = take(makeScene(params).frames(), 5 * 24);
    const d = scene.truth.displacementPx;
    let peak = 0;
    let trough = 0;
    for (let i = 0; i < frames.length; i++) {
      if (d[i] > d[peak]) peak = i;
      if (d[i] < d[trough]) trough = i;
    }
    expect(d[peak]).toBeGreaterThan(3.99); // sampled at 24 fps: never exactly on phase 0.4
    expect(d[trough]).toBeLessThan(0.01);
    // Inhaling raises the edge: a smaller row index at the peak. The wall/body decision is per
    // integer row, so a 3.999 px rise shows as 3 or 4 rows.
    const rise = edgeRow(frames[trough]) - edgeRow(frames[peak]);
    expect(rise).toBeGreaterThanOrEqual(3);
    expect(rise).toBeLessThanOrEqual(4);
    // The body texture moved up with the edge: the peak frame matches the trough frame four
    // rows further down (3.999 px, so within interpolation error), and nothing else nearby.
    const roi = scene.roiInterior;
    const meanDiffAt = (dy: number) => {
      let sum = 0;
      for (let y = roi.y; y < roi.y + roi.h; y++) {
        for (let x = roi.x; x < roi.x + roi.w; x++) {
          const at = textured[peak].data[y * 96 + x];
          const below = textured[trough].data[(y + dy) * 96 + x];
          sum += Math.abs(at - below);
        }
      }
      return sum / (roi.w * roi.h);
    };
    expect(meanDiffAt(4)).toBeLessThan(1.5);
    expect(meanDiffAt(0)).toBeGreaterThan(10);
    expect(meanDiffAt(-4)).toBeGreaterThan(10);
  });

  it('breathWaveform rises over 40 % of the cycle and returns to 0', () => {
    expect(breathWaveform(0)).toBe(0);
    expect(breathWaveform(0.4)).toBeCloseTo(1, 12);
    expect(breathWaveform(0.2)).toBeCloseTo(0.5, 12);
    expect(breathWaveform(0.7)).toBeCloseTo(0.5, 12);
    expect(breathWaveform(1)).toBeCloseTo(0, 12);
  });

  it('inhaleOnsetsS count equals bpm·seconds/60 ± 1 for 30 bpm, 60 s', () => {
    const { truth } = makeScene({ ...BASE, seconds: 60 });
    expect(Math.abs(truth.inhaleOnsetsS.length - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(truth.inhaleOnsetsS[0] - 2)).toBeLessThan(0.1);
  });

  it('windowBpm follows a ramp 24 → 36', () => {
    const { truth } = makeScene({ ...BASE, seconds: 60, bpm: 24, rateRampBpm: 12 });
    expect(Math.abs(truth.windowBpm(0, 15) - 25.5)).toBeLessThan(0.5);
    expect(Math.abs(truth.windowBpm(45, 15) - 34.5)).toBeLessThan(0.5);
    expect(Math.abs(truth.windowBpm(0, 60) - 30)).toBeLessThan(0.5);
  });

  it('windowBpm is exact for windows ending at the clip end', () => {
    // The truth is the phase difference between the window's two instants, not between the
    // last frames before them: a 60 s clip has 1,800 frames but 1,801 frame instants.
    const { truth } = makeScene({ ...BASE, seconds: 60, fps: 30 });
    expect(truth.windowBpm(45, 15)).toBeCloseTo(30, 6);
    expect(truth.windowBpm(30, 30)).toBeCloseTo(30, 6);
    expect(truth.windowBpm(0, 60)).toBeCloseTo(30, 6);
    expect(truth.windowBpm(0, 15)).toBeCloseTo(30, 6);
  });

  it('roiInterior stays inside the body at A = 4 with twitches', () => {
    const scene = makeScene({
      ...BASE,
      seconds: 10,
      amplitudePx: 4,
      twitches: 2,
      contrast: 0,
      noiseSigma: 0,
      driftPxPerFrame: 0,
    });
    const roi: Roi = scene.roiInterior;
    expect(roi).toEqual({ x: 24, y: 48, w: 48, h: 16 });
    expect(Math.max(...scene.truth.displacementPx)).toBeGreaterThan(15);
    for (const frame of scene.frames()) {
      for (let y = roi.y; y < roi.y + roi.h; y++) {
        for (let x = roi.x; x < roi.x + roi.w; x++) {
          if (frame.data[y * frame.width + x] !== 110) {
            throw new Error(`wall pixel inside roiInterior at (${x}, ${y})`);
          }
        }
      }
    }
  });

  it('scales the ROIs with the frame', () => {
    const scene = makeScene({ ...BASE, width: 192, height: 144 });
    expect(scene.roiEdge).toEqual({ x: 48, y: 24, w: 96, h: 96 });
    expect(scene.roiInterior).toEqual({ x: 48, y: 84, w: 96, h: 52 });
    expect(scene.background).toEqual({ x: 0, y: 0, w: 192, h: 40 });
    expect(makeScene(BASE).background).toEqual({ x: 0, y: 0, w: 96, h: 20 });
  });
});

describe('end to end', () => {
  it('profileMotion on an A = 2 edge scene feeds estimate() within 1 bpm', () => {
    const scene = makeScene({ ...BASE, seconds: 20 });
    const motion = profileMotion(scene.frames(), scene.roiEdge, BASE.fps, {
      background: scene.background,
    });
    const r = estimate(motion.signal, BASE.fps, motion.quality);
    expect(r.reasons).toEqual([]);
    expect(r.bpm).not.toBeNull();
    expect(Math.abs(r.bpm! - scene.truth.windowBpm(0, 20))).toBeLessThan(1);
  });
});
