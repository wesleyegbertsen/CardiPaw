import { describe, expect, it } from 'vitest';
import {
  PLACEMENT,
  coverCrop,
  defaultRoi,
  frameRateReason,
  frameTiming,
  greyFromRgba,
  gridSamples,
  nearCeiling,
  placementSample,
  resampleRow,
} from './capture.ts';
import { estimate } from './estimate.ts';
import { createLkTracker } from './motion.ts';
import { lcg, makeScene } from './synth.ts';

/** n stamps at a fixed period, starting at 0. */
const stamps = (n: number, periodMs: number) => Array.from({ length: n }, (_, i) => i * periodMs);
const NTSC = 1000 / 29.97;

describe('frameTiming', () => {
  it('measures the delivered rate and the largest gap', () => {
    const t = frameTiming(stamps(901, NTSC));
    expect(t.count).toBe(901);
    expect(t.fps).toBeCloseTo(29.97, 5);
    expect(t.maxGapMs).toBeCloseTo(NTSC, 9);
    expect(t.spanMs).toBeCloseTo(900 * NTSC, 6);
  });

  it('has no rate below two frames', () => {
    expect(frameTiming([])).toEqual({ count: 0, spanMs: 0, fps: null, maxGapMs: 0 });
    expect(frameTiming([5])).toEqual({ count: 1, spanMs: 0, fps: null, maxGapMs: 0 });
    expect(frameTiming([5, 5]).fps).toBeNull(); // two frames on one stamp: no rate
  });
});

describe('frameRateReason', () => {
  it('accepts a clean 29.97 fps window', () => {
    expect(frameRateReason(frameTiming(stamps(900, NTSC)), 30)).toBeNull();
  });

  it('refuses a 15 fps run', () => {
    const t = frameTiming(stamps(451, 1000 / 15));
    expect(t.fps).toBeCloseTo(15, 9);
    expect(frameRateReason(t, 30)).toBe('frame-rate');
  });

  it('refuses one 120 ms gap and allows one of exactly 100 ms', () => {
    const withGap = (gap: number) => {
      const s = stamps(900, NTSC);
      for (let i = 450; i < s.length; i++) s[i] += gap - NTSC;
      return frameTiming(s);
    };
    expect(frameRateReason(withGap(120), 30)).toBe('frame-rate');
    expect(frameRateReason(withGap(100), 30)).toBeNull();
    expect(frameRateReason(withGap(99), 30)).toBeNull();
  });

  it('allows the window to end two frame periods early, not three', () => {
    // 899 stamps span 898 periods: 29 963 ms, inside the 66.7 ms slack; 898 span 29 930 ms.
    expect(frameRateReason(frameTiming(stamps(899, NTSC)), 30)).toBeNull();
    expect(frameRateReason(frameTiming(stamps(898, NTSC)), 30)).toBe('frame-rate');
  });

  it('pins the 28 fps edge', () => {
    expect(frameRateReason(frameTiming(stamps(841, 1000 / 28)), 30)).toBeNull();
    expect(frameRateReason(frameTiming(stamps(841, 1000 / 27.99)), 30)).toBe('frame-rate');
  });

  it('forgives only the one gap that starts at the exempt frame', () => {
    // 60 s at 29.97 fps with one 150 ms hold: the frame after `at` comes late.
    const held = (at: number) => {
      const s = stamps(1800, NTSC);
      for (let i = at + 1; i < s.length; i++) s[i] += 150 - NTSC;
      return s;
    };
    const afterThirty = held(900);
    expect(frameRateReason(frameTiming(afterThirty), 60)).toBe('frame-rate');
    expect(frameRateReason(frameTiming(afterThirty, afterThirty[900]), 60)).toBeNull();
    const elsewhere = held(300);
    expect(frameRateReason(frameTiming(elsewhere, elsewhere[900]), 60)).toBe('frame-rate');
    // Only maxGapMs changes: the rate and the span still count every frame.
    const { fps, spanMs, count } = frameTiming(afterThirty);
    expect(frameTiming(afterThirty, afterThirty[900])).toEqual({
      count,
      spanMs,
      fps,
      maxGapMs: expect.closeTo(NTSC, 9),
    });
  });

  it('refuses a window the frames do not cover', () => {
    expect(frameRateReason(frameTiming(stamps(600, NTSC)), 30)).toBe('frame-rate');
    expect(frameRateReason(frameTiming(stamps(1800, NTSC)), 60)).toBeNull();
  });
});

describe('gridSamples', () => {
  it('is the exact window estimate() quantises on', () => {
    expect(gridSamples(30)).toBe(900);
    expect(gridSamples(60)).toBe(1800);
  });
});

describe('resampleRow', () => {
  it('puts a 1 Hz sine sampled at 29.97 fps onto the 30 Hz grid within 0.01', () => {
    const times = stamps(901, NTSC);
    const row = times.map((t) => Math.sin((2 * Math.PI * t) / 1000));
    const out = resampleRow(row, times, 900);
    for (let i = 0; i < 900; i++) {
      expect(Math.abs(out[i] - Math.sin((2 * Math.PI * i) / 30))).toBeLessThan(0.01);
    }
  });

  it('takes the later of two frames on one stamp', () => {
    expect([...resampleRow([1, 9, 3], [0, 0, 100], 2, 10)]).toEqual([9, 3]);
  });

  it('holds the last value past the last stamp', () => {
    const out = resampleRow([1, 2, 3], [0, 100, 200], 10);
    expect(out[9]).toBe(3);
    expect(out[0]).toBe(1);
  });

  it('throws on a length mismatch or empty input', () => {
    expect(() => resampleRow([1, 2], [0], 5)).toThrow('2 values for 1 timestamps');
    expect(() => resampleRow([], [], 5)).toThrow();
  });
});

describe('the app path', () => {
  it('never hands estimate() an off-grid window: jittered 29.97 fps frames read within 1 bpm of the exact grid', () => {
    // 96×72 like motion.scene.test.ts: the full-size scene takes ten seconds under coverage.
    const params = {
      seed: 1,
      width: 96,
      height: 72,
      fps: 30,
      seconds: 31,
      bpm: 24,
      amplitudePx: 2,
      contrast: 20,
    };
    const scene = makeScene(params);
    const exact = createLkTracker(scene.roiEdge, 30);
    const jittered = createLkTracker(scene.roiEdge, 30);
    const rand = lcg(7);
    const times: number[] = [];
    let k = 0;
    for (const frame of scene.frames()) {
      exact.push(frame);
      // The same frames with real-world stamps: 29.97 fps plus ±2 ms jitter.
      jittered.push(frame);
      times.push(k * NTSC + (rand() - 0.5) * 4);
      k++;
    }
    const exactRes = exact.result((r) => r.slice(0, 900));
    const exactEst = estimate(exactRes.signal, 30, exactRes.quality);
    const res = jittered.result((r) => resampleRow(r, times, gridSamples(30)));
    const est = estimate(res.signal, 30, res.quality);
    expect(exactEst.reasons).toEqual([]);
    expect(est.reasons).toEqual([]);
    expect(est.interval).not.toBeNull();
    expect(est.quantisedBpm).toBe(24);
    expect(Math.abs(est.bpm! - exactEst.bpm!)).toBeLessThan(1);
  }, 15_000); // a 31 s window pushed twice: near the default 5 s under coverage
});

describe('nearCeiling', () => {
  it.each([
    [31, true],
    [32, false],
    [34, true],
    [36, true],
    [37, false],
    [29, true],
    [28, false],
  ])('%s near [30, 35] is %s', (bpm, near) => {
    expect(nearCeiling(bpm, [30, 35])).toBe(near);
  });
});

describe('greyFromRgba', () => {
  it('weights red, green and blue by BT.601 and ignores alpha', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255, 0, 255, 0, 7]);
    expect([...greyFromRgba(rgba, 3, 1).data]).toEqual([77, 29, 149]);
    expect(() => greyFromRgba(rgba, 2, 1)).toThrow('12 bytes for 2 pixels');
  });
});

describe('defaultRoi', () => {
  it('scales the strip with the frame and keeps the box below it', () => {
    expect(defaultRoi({ width: 96, height: 72 })).toEqual({
      roi: { x: 19, y: 20, w: 58, h: 36 },
      background: { x: 0, y: 0, w: 96, h: 20 },
    });
  });

  it('centres a 60 % × 50 % box below the top strip at 192×144', () => {
    expect(defaultRoi({ width: 192, height: 144 })).toEqual({
      roi: { x: 38, y: 40, w: 116, h: 72 },
      background: { x: 0, y: 0, w: 192, h: 40 },
    });
  });
});

describe('placementSample', () => {
  const flat = (level: number) => ({
    width: 64,
    height: 48,
    data: new Uint8Array(64 * 48).fill(level),
  });

  it('reads the mean luma and has no flow on the first frame', () => {
    const s = placementSample(null, flat(20), { x: 0, y: 0, w: 64, h: 16 });
    expect(s).toEqual({ luma: 20, flowPx: null });
  });

  it('has no flow when nothing in the strip tracks', () => {
    const s = placementSample(flat(20), flat(20), { x: 0, y: 0, w: 64, h: 16 });
    expect(s.flowPx).toBeNull();
  });

  it('is below maxFlowPx on a propped scene and above it at 1 px rms shake', () => {
    const flows = (shakeRmsPx: number) => {
      const scene = makeScene({
        seed: 3,
        fps: 30,
        seconds: 4,
        bpm: 24,
        amplitudePx: 2,
        contrast: 20,
        shakeRmsPx,
      });
      let anchor: ReturnType<typeof flat> | null = null;
      let i = 0;
      const out: number[] = [];
      for (const frame of scene.frames()) {
        // As the composable does: the anchor is renewed every PLACEMENT.anchorFrames.
        if (i++ % PLACEMENT.anchorFrames === 0) anchor = frame;
        const s = placementSample(anchor, frame, scene.background);
        if (s.flowPx !== null) out.push(s.flowPx);
      }
      return out;
    };
    const still = flows(0);
    const shaking = flows(1);
    expect(Math.max(...still)).toBeLessThan(PLACEMENT.maxFlowPx);
    const above = shaking.filter((f) => f > PLACEMENT.maxFlowPx).length / shaking.length;
    expect(above).toBeGreaterThan(0.5);
  });
});

describe('coverCrop', () => {
  it.each([
    ['a 4:3 frame whole', 640, 480, { sx: 0, sy: 0, sw: 640, sh: 480 }],
    ['the middle of a portrait frame', 480, 640, { sx: 0, sy: 140, sw: 480, sh: 360 }],
    ['the middle of a 16:9 frame', 1280, 720, { sx: 160, sy: 0, sw: 960, sh: 720 }],
    ['a whole-pixel origin from an odd width', 641, 480, { sx: 0, sy: 0, sw: 640, sh: 480 }],
    ['nothing before metadata', 0, 0, { sx: 0, sy: 0, sw: 0, sh: 0 }],
  ])('takes %s', (_label, vw, vh, crop) => {
    expect(coverCrop(vw, vh, 192, 144)).toEqual(crop);
  });
});
