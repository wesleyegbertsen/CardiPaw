// Breathing-rate estimate from one unfiltered motion signal, with the quality features and the
// reasons for abstaining. Pure module: ES2020 only, no Node built-ins. It is the only place that
// turns numbers into a verdict, so the gate thresholds live here with their calibration.

import { breathsPerMinute, isMeasurementSeconds } from '../../src/utils/measurement.ts';
import type { MotionQuality } from './motion.ts';
import {
  acfBpm,
  bandpass,
  fftPeak,
  findPeaks,
  linearDetrend,
  mad,
  median,
  peakBpm,
  rms,
  spectralFeatures,
  spectrum,
} from './signal.ts';

export type AbstainReason =
  | 'too-short'
  | 'few-tracks'
  | 'shake' // motion quality, evaluated first: it explains everything that follows
  | 'no-signal'
  | 'fast-motion'
  | 'weak-periodicity'
  | 'estimators-disagree'
  | 'irregular'
  | 'twitch'
  | 'low-quality'; // the mean gate score fell below GATES.quality with no single gate tripped

export interface QualityFeatures {
  seconds: number;
  rmsRaw: number;
  peakShare: number;
  aboveBandPeakRatio: number;
  aboveBandRatio: number;
  acfPeak: number | null;
  disagreement: number;
  ibiCv: number | null;
  twitchFraction: number;
  borderRms?: number;
  validTrackRatio?: number;
}

export interface EstimateResult {
  bpm: number | null; // median of the available estimators; null when abstaining
  rawBpm: number | null; // the same median even when abstaining (for calibration tables)
  breaths: number | null; // round(bpm · seconds / 60)
  // On the 15/30/60 s grid: breathsPerMinute(breaths, seconds) and that reading ± half a quantum
  // (rounded outward). Off-grid (449 samples at 30 fps, a 20 s window): round(bpm) and null.
  quantisedBpm: number | null;
  interval: [number, number] | null;
  estimators: { fft: number | null; acf: number | null; ibi: number | null; count: number };
  quality: number; // 0–1
  reasons: AbstainReason[]; // empty when accepted; every abstain carries at least one
  features: QualityFeatures;
}

/**
 * Gate thresholds. Calibration on rendered scenes (LK extractor, 30 s windows, 2026-11-03):
 * good p05 / no-breathing p95 — peakShare 0.76/0.53, acfPeak 0.73/0.30, disagreement 0.11/36,
 * ibiCv 0.01/0.68, quality 0.94/0.65; borderRms 0.06 at 0 px shake, 0.65 at 1 px, 1.88 at 3 px.
 */
export const GATES = {
  peakShare: 0.5,
  acfPeak: 0.5,
  disagreement: 3,
  ibiCv: 0.3,
  twitch: 0.2,
  aboveBandPeak: 1,
  borderRms: 1.2,
  validTracks: 0.6,
  quality: 0.7,
  minSeconds: 10,
  minCycles: 3,
} as const;
export type Gates = { [K in keyof typeof GATES]: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function emptyFeatures(seconds: number, motion: MotionQuality): QualityFeatures {
  return {
    seconds,
    rmsRaw: 0,
    peakShare: 0,
    aboveBandPeakRatio: 0,
    aboveBandRatio: 0,
    acfPeak: null,
    disagreement: 0,
    ibiCv: null,
    twitchFraction: 0,
    borderRms: motion.borderRms,
    validTrackRatio: motion.validTrackRatio,
  };
}

function abstain(reasons: AbstainReason[], features: QualityFeatures): EstimateResult {
  return {
    bpm: null,
    rawBpm: null,
    breaths: null,
    quantisedBpm: null,
    interval: null,
    estimators: { fft: null, acf: null, ibi: null, count: 0 },
    quality: 0,
    reasons,
    features,
  };
}

/** Which abstain reasons the extractor's own quality report earns, before the signal is read. */
function motionReasons(motion: MotionQuality, gates: Gates): AbstainReason[] {
  const reasons: AbstainReason[] = [];
  if (motion.validTrackRatio !== undefined && motion.validTrackRatio < gates.validTracks) {
    reasons.push('few-tracks');
  }
  if (motion.borderRms !== undefined && motion.borderRms >= gates.borderRms) reasons.push('shake');
  return reasons;
}

/**
 * Estimates the breathing rate of an unfiltered motion signal sampled at `fps`. Three
 * estimators (FFT peak, autocorrelation, inter-breath interval) must agree, the spectrum must be
 * dominated by one in-band peak, and the breaths must be regular; otherwise the result abstains
 * with every reason that applies. Under-counting would silently cancel the app's rise rule, so
 * abstaining beats a low number.
 */
export function estimate(
  raw: Float64Array,
  fps: number,
  motion: MotionQuality = {},
  gates: Gates = GATES,
): EstimateResult {
  const n = raw.length;
  const seconds = n / fps;
  if (seconds < gates.minSeconds) return abstain(['too-short'], emptyFeatures(seconds, motion));

  const reasons = motionReasons(motion, gates);
  const x = linearDetrend(raw);
  const rmsRaw = rms(x);
  if (rmsRaw < 1e-6) {
    reasons.push('no-signal');
    return abstain(reasons, { ...emptyFeatures(seconds, motion), rmsRaw });
  }

  // The spectrum is read unfiltered so the fast-motion gate can still see above-band energy.
  const sp = spectrum(x, fps);
  const fp = fftPeak(sp);
  const sf = spectralFeatures(sp, fp.bin);
  const y = bandpass(x, fps);
  const acf = acfBpm(y, fps);
  const pk = peakBpm(findPeaks(y, fps), fps, seconds);
  // Outliers are counted on the detrended raw signal: the band-pass smears a 0.3 s jump into
  // the breathing band and inflates the MAD with it, so on `y` the twitch gate never fires.
  const sigma = 1.4826 * (mad(x) ?? 0); // MAD → σ for a normal distribution
  let twitches = 0;
  for (const v of x) if (Math.abs(v) > 5 * sigma) twitches++;
  const twitchFraction = twitches / n;

  const estimators = {
    fft: fp.bpm,
    acf: acf !== null && !acf.weak ? acf.bpm : null,
    ibi: pk.ibiBpm,
    count: pk.count,
  };
  const available = [estimators.fft, estimators.acf, estimators.ibi].filter(
    (v): v is number => v !== null,
  );
  let disagreement = 0;
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      disagreement = Math.max(disagreement, Math.abs(available[i] - available[j]));
    }
  }
  const bpm = median(available) ?? fp.bpm;
  const ibiCv = pk.ibiCv ?? 1; // fewer than three peaks is not a reading
  const acfPeak = acf === null ? null : acf.peak;

  const features: QualityFeatures = {
    seconds,
    rmsRaw,
    peakShare: sf.peakShare,
    aboveBandPeakRatio: sf.aboveBandPeakRatio,
    aboveBandRatio: sf.aboveBandRatio,
    acfPeak,
    disagreement,
    ibiCv,
    twitchFraction,
    borderRms: motion.borderRms,
    validTrackRatio: motion.validTrackRatio,
  };

  if (sf.peakShare < gates.peakShare) reasons.push('no-signal');
  if (sf.aboveBandPeakRatio >= gates.aboveBandPeak) reasons.push('fast-motion');
  if (acf === null || acf.weak || acf.peak < gates.acfPeak) reasons.push('weak-periodicity');
  if (disagreement > gates.disagreement) reasons.push('estimators-disagree');
  if (ibiCv > gates.ibiCv) reasons.push('irregular');
  if (twitchFraction > gates.twitch) reasons.push('twitch');
  if ((bpm * seconds) / 60 < gates.minCycles) reasons.push('too-short');

  const scores = [
    Math.min(1, sf.peakShare / gates.peakShare),
    Math.min(1, (acfPeak ?? 0) / gates.acfPeak),
    Math.max(0, 1 - disagreement / gates.disagreement),
    Math.max(0, 1 - ibiCv / gates.ibiCv),
    Math.max(0, 1 - twitchFraction / gates.twitch),
    clamp01(1 - sf.aboveBandPeakRatio),
  ];
  const quality = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (reasons.length === 0 && quality < gates.quality) reasons.push('low-quality');
  const accepted = reasons.length === 0;
  if (!accepted) {
    return { ...abstain(reasons, features), rawBpm: bpm, estimators, quality };
  }

  // Report the rate the way a tapped measurement would: whole breaths over the window.
  const breaths = Math.round((bpm * seconds) / 60);
  const onGrid = isMeasurementSeconds(seconds);
  const quantisedBpm = onGrid ? breathsPerMinute(breaths, seconds) : Math.round(bpm);
  const halfQuantum = Math.ceil(60 / seconds / 2);
  const interval: [number, number] | null = onGrid
    ? [quantisedBpm - halfQuantum, quantisedBpm + halfQuantum]
    : null;
  return {
    bpm,
    rawBpm: bpm,
    breaths,
    quantisedBpm,
    interval,
    estimators,
    quality,
    reasons,
    features,
  };
}
