// Lucas-Kanade on rendered scenes. Kept apart from motion.test.ts so each file stays under a
// second: every scene here is 96×72 at 24 fps (30 fps for the purr) and 12–15 s long.
import { describe, expect, it } from 'vitest';
import { estimate } from './estimate.ts';
import { lkMotion, profileMotion } from './motion.ts';
import { makeScene } from './synth.ts';
import type { SceneParams } from './synth.ts';

const BASE: SceneParams = {
  seed: 1,
  width: 96,
  height: 72,
  fps: 24,
  seconds: 15,
  bpm: 30,
  amplitudePx: 1,
  contrast: 40,
};

function lkEstimate(params: SceneParams, roi: 'roiEdge' | 'roiInterior' = 'roiEdge') {
  const scene = makeScene(params);
  const motion = lkMotion(scene.frames(), scene[roi], params.fps, {
    background: scene.background,
  });
  return { motion, result: estimate(motion.signal, params.fps, motion.quality) };
}

describe('lkMotion on scenes', () => {
  it('0.4 Hz 5 % flicker on a 30 bpm scene reads 30, not 24, and an A = 0 flicker scene abstains', () => {
    const flicker = { hz: 0.4, depth: 0.05 }; // 24 bpm of brightness modulation, in band
    const lit = lkEstimate({ ...BASE, flicker });
    expect(lit.result.reasons).toEqual([]);
    expect(Math.abs(lit.result.bpm! - 30)).toBeLessThan(1);
    const still = lkEstimate({ ...BASE, amplitudePx: 0, flicker });
    expect(still.result.bpm).toBeNull();
    expect(still.result.reasons.length).toBeGreaterThan(0);
  });

  it('fast-motion fires on a 30 fps scene with a 1 px 25 Hz purr', () => {
    // 25 Hz sampled at 30 fps aliases to 5 Hz: above the band, so the unfiltered spectrum
    // still shows it. An extractor that band-passed its output would hide it.
    const { result } = lkEstimate({
      ...BASE,
      fps: 30,
      seconds: 12,
      purr: { hz: 25, amplitudePx: 1 },
    });
    expect(result.bpm).toBeNull();
    expect(result.reasons).toContain('fast-motion');
  });

  it('lkMotion on a 3 px-shake scene reports borderRms ≥ 1.5 and estimate() says shake', () => {
    const { motion, result } = lkEstimate({ ...BASE, shakeRmsPx: 3 });
    expect(motion.quality.borderRms).toBeGreaterThanOrEqual(1.5);
    expect(result.reasons).toContain('shake');
  });

  it('few-tracks on a contrast-0 interior ROI', () => {
    const { motion, result } = lkEstimate({ ...BASE, seconds: 12, contrast: 0 }, 'roiInterior');
    expect(motion.quality.validTrackRatio).toBeLessThan(0.6);
    expect(result.reasons[0]).toBe('few-tracks');
  });

  it('lkMotion and profileMotion agree within 0.5 bpm on an A = 2 scene', () => {
    const params = { ...BASE, amplitudePx: 2 };
    const lk = lkEstimate(params);
    const scene = makeScene(params);
    const profile = profileMotion(scene.frames(), scene.roiEdge, params.fps, {
      background: scene.background,
    });
    const p = estimate(profile.signal, params.fps, profile.quality);
    expect(lk.result.reasons).toEqual([]);
    expect(p.reasons).toEqual([]);
    expect(Math.abs(lk.result.bpm! - p.bpm!)).toBeLessThan(0.5);
    expect(Math.abs(lk.result.bpm! - scene.truth.windowBpm(0, params.seconds))).toBeLessThan(0.5);
  });
});
