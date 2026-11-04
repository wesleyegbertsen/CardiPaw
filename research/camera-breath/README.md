# Camera-based breath counting (research)

Prototype for estimating a pet's breathing rate from a propped-phone video, exploring
[#130](https://github.com/wesleyegbertsen/CardiPaw/issues/130). Not part of the app: nothing in
this folder is bundled, and the app asks for no camera permission.

## 1. What this is

A research note with runnable code. The question is whether a phone video of a resting cat or
dog, taken by the owner, can yield a breathing rate the app could offer _as a suggestion_, with
the same whole-breath quantisation as a tapped measurement, and — more importantly — whether
the method knows when it cannot.

The harm model drives every design choice here: a camera reading that is too **low** silently
cancels the rise rule in `src/utils/trend.ts` (the thing that tells an owner to call the vet),
whereas a reading that is missing just leaves the owner tapping as today. So the estimator
abstains with a reason whenever its three estimators disagree, the spectrum is not dominated by
one in-band peak, the breaths are irregular, or the camera shook; _abstain beats a low number_.

## 2. How it works

```
grey frames → ROI → motion signal (px per frame)
    primary:     5×5 Lucas-Kanade grid, background flow subtracted, per-point PCA   (lkMotion)
    cross-check: 1-D row-profile cross-correlation, background strip subtracted    (profileMotion)
  → linear detrend → zero-phase Butterworth 0.15–1.5 Hz (9–90 bpm)
  → FFT peak / autocorrelation peak / peak count + inter-breath intervals
  → agreement + quality gate → bpm, quantisedBpm (breathsPerMinute, as taps), interval, reasons
```

- `motion.ts` — `Frame`, `Roi`, the two extractors. Lucas-Kanade tracks 25 points in the ROI
  against a reference frame renewed every 2 s on 3×3-blurred frames with a coarse pass on the
  half-size frame, cancels the whole-frame brightness gain (flicker, auto-exposure), subtracts
  the median flow of the background strip (camera shake), and combines the 50 trajectories by
  their first principal component. The profile method correlates the ROI's row means against
  the reference; it reads only vertical motion and is kept as a cross-check.
- `signal.ts` — detrend, RBJ biquads in `filtfilt`, radix-2 FFT with Hann window and 8× zero
  padding, biased normalised autocorrelation, prominence-based peak picking.
- `estimate.ts` — `estimate(signal, fps, motionQuality)` → `EstimateResult`. Everything that
  turns numbers into a verdict lives here.
- `synth.ts` — seeded synthetic flank scenes with ground truth (texture, edge, breathing
  waveform, drift, shake, flicker, purr, twitches, rate ramp).
- `score.ts` — metrics, sidecar parsing, verdict tables, the pre-registered thresholds.
- `ingest.ts`, `run.ts` — ffmpeg/ffprobe and the CLI (the only Node-specific files; an ESLint
  fence keeps every Node built-in out of the pure modules so they would move into the app as is).

Gates (`GATES` in `estimate.ts`), in the order they are evaluated, with the calibration that
set them (Lucas-Kanade, rendered 192×144 scenes, 30 s windows, 2026-11-03):

| Gate | Reason | Threshold | Good scenes (p05) | No breathing (p95) |
|---|---|---|---|---|
| clip length | `too-short` | < 10 s, or < 3 cycles | — | — |
| valid tracks | `few-tracks` | validTrackRatio < 0.6 | — | — |
| background motion | `shake` | borderRms ≥ 1.2 px | 0.06 (0 px shake), 0.65 (1 px) | 1.88 (3 px) |
| spectral peak share | `no-signal` | peakShare < 0.5 | 0.76 | 0.53 |
| above-band peak | `fast-motion` | aboveBandPeakRatio ≥ 1 | — | — |
| autocorrelation peak | `weak-periodicity` | acfPeak < 0.5 (or weak) | 0.73 | 0.30 |
| estimator spread | `estimators-disagree` | > 3 bpm | 0.11 | 36 |
| interval regularity | `irregular` | ibiCv > 0.3 | 0.01 | 0.68 |
| outliers | `twitch` | twitchFraction > 0.2 (on the detrended raw signal) | — | — |
| overall | `low-quality` | quality < 0.7 with no other reason | 0.94 | 0.65 |

A reading is accepted only with no reason, so every abstain names at least one. `bpm` is the
median of the three estimators; `quantisedBpm` is `breathsPerMinute(round(bpm·s/60), s)` for
15/30/60 s windows, so a camera reading lands on the same grid as a tapped one, and `interval`
is that reading ± half a quantum (±2 at 15 s, ±1 at 30 and 60 s).

## 3. Running it

Node 24 runs the TypeScript directly; ffmpeg 8 (`ffmpeg` and `ffprobe`) must be on PATH.
`research/camera-breath/clips/` (recordings and sidecars) and `research/camera-breath/out/`
(sweep output, dumps, reports) are git-ignored and excluded from the Docker build context;
paths on the command line are relative to the shell, so write them out in full.

```bash
node research/camera-breath/run.ts synth --subset smoke            # 14 cells, ~30 s, exit 1 on a failed criterion
node research/camera-breath/run.ts synth --encode                  # core sweep (520 cells) through libx264, ~25 min
node research/camera-breath/run.ts analyse research/camera-breath/clips/cat1.mp4 --roi 80,60,120,100 \
    --dump-frame research/camera-breath/out/cat1-first.pgm
node research/camera-breath/run.ts score research/camera-breath/clips/cat1.mp4 \
    --truth research/camera-breath/clips/cat1.csv --roi 80,60,120,100 --window 30 \
    --md research/camera-breath/out/cat1.md
```

`analyse` prints the working size (the displayed frame scaled to a longest side of 320 px,
rotation metadata honoured, never upscaled) and expects `--roi x,y,w,h` in those pixels: run it
once with `--dump-frame`, open the PGM, read the chest/flank edge off it. The
background strip (default: the top 40 rows, `--background` to move it) must show static scene
only; `analyse` warns when it has no texture, and below 28 fps (see §6). `--json` prints the
machine-readable result, `--dump` the raw and filtered waveforms.

`npm run typecheck`, `npm run lint` and `npm test` cover this folder like `scripts/` (the
`node` vitest project). Because `npm run build` runs `vue-tsc -b` over every referenced
project, a type error here blocks the app build on purpose; `@types/node` is a transitive
dependency (via `@capacitor/cli`), the same exposure `tsconfig.node.json` already has. No unit
test spawns ffmpeg, and the sweep is never run by vitest or CI.

## 4. Pre-registered thresholds

Written on 2026-11-03, before any real recording existed. Accepted windows only; the "Real"
column applies to owner recordings scored with `score`.

| Criterion | Synthetic | Real |
|---|---|---|
| MAE | ≤ 1.0 bpm at 30/60 s, ≤ 2.0 at 15 s | ≤ 2.0 bpm at 30/60 s |
| Within ±2 bpm (30/60 s windows) | ≥ 98 % | ≥ 90 % |
| Within ±4 bpm (all windows) | 100 % | ≥ 97 % |
| Under-count beyond −4 bpm | 0 | 0 |
| Label agreement via `getRateStatus` (30/60 s windows) | 100 % | ≥ 90 %, **no High→Normal** |
| Correct abstain on no-signal / 3 px shake / in-band flicker with tiny amplitude | ≥ 90 % | ≥ 90 % on degraded clips |
| False abstain on good clips (primary method) | ≤ 25 % | ≤ 25 % |

One clarification made while implementing the scorer, before the core sweep ran: a 15 s window
is quantised to 4 bpm by `breathsPerMinute`, exactly as a tapped 15 s reading is, so a perfect
30 bpm estimate reads 28 or 32 (7.5 breaths rounds either way). ±2 and the label are therefore
undecidable at 15 s by construction and are judged on 30/60 s windows; MAE was already split
per window length; ±4, the under-count and High→Normal use every window.

## 5. Synthetic results

Core sweep, run on 2026-11-04 at commit `a6f8a1e` with Node v24.22.1 and ffmpeg 8.0.1 (gyan.dev
essentials build), every cell round-tripped through libx264 at CRF 28 (`--encode`), 1235 s wall:
520 cells (340 core: 17 rates × 5 amplitudes × 4 shake levels; 150 nuisance; 30 refusal), 60 s each
at 192×144, three extractions per cell (lk-edge, lk-interior, profile-edge), 15/30/60 s windows,
10,920 windows in all. The verdict is on the primary method (Lucas-Kanade, both ROI placements,
7,280 windows); the profile method appears in the breakdowns only. The sweep exited 1: **eight
criteria pass, label agreement fails** (98.0 % against the pre-registered 100 %).

What the failing 2 % is: all 42 label flips are 30 s windows at exactly 31 bpm read as 30
(Elevated → Normal, 15.5 breaths rounds either way) and exactly 35 bpm read as 36 (Elevated →
High, 17.5 breaths). The largest error among them is 1.04 bpm, no flip is High → Normal, and no
60 s window flips (its quantum is 1 bpm). A tapped 30 s measurement of the same animal lands on
the same grid and flips the same way, so this is the quantum of the 30 s window meeting a
ceiling, not a bias of the method; the 100 % threshold did not anticipate rates sitting exactly
one bpm above a ceiling. It still fails as registered. The honest reading is: on 30 s windows the
label is reliable except within ±1 bpm of a ceiling, where only a 60 s window decides.

Other findings:

- **False abstains (5.8 %, 267 of 4,602 good primary windows)** are concentrated at the low
  rates the grid includes on purpose: 8 bpm (72, four cycles in 30 s), 12 bpm (49) and 18 bpm
  (72, mostly 15 s windows with 4.5 cycles), with `weak-periodicity`, `irregular` and
  `estimators-disagree` as the reasons. Above 24 bpm the false-abstain rate is below 2 %.
  Edge and interior ROI placements abstain alike (135 and 132).
- **Refusal is complete**: 0 of 1,610 primary windows that should abstain (no breathing, 3 px
  shake) were accepted.
- **Detection floors**: at 0.3 px amplitude 78 % of windows abstain and at 0.5 px 57 %, at
  1 px 34 %; the accepted ones are accurate (MAE ≤ 0.7 bpm). Lucas-Kanade therefore reads
  down to about 0.5 px at 192×144 with the abstain rate as the signal that it is marginal; the
  profile method abstains on 77 % of all windows and is a cross-check only.
- **15 s windows**: MAE 0.95 bpm, i.e. the 4 bpm quantum; nothing beyond ±4.
- **Nuisances** (A = 1, 0.5 px shake, 18/30/36 bpm, five seeds): 10 Hz and 100 Hz flicker,
  a 0.3 px purr, two twitches, a +6 bpm ramp, 24 and 60 fps all stay at 19–25 % abstain and
  MAE ≤ 0.76 bpm. In-band 0.5 Hz / 2 % flicker on A = 1 (neither good nor must-abstain by the
  pre-registration) was accepted on 51 % of windows with a largest error of 2.08 bpm, i.e. the
  15 s quantum: the whole-frame gain cancellation removes it. Contrast 10 raises the abstain
  rate to 79 %; `twitchFraction` never fired for Lucas-Kanade (twitches show as validity dips
  and the windows are read anyway).
- The smoke subset (14 cells, in-process and encoded) passes all nine criteria; the encoded
  smoke run's only false abstain is an 18 bpm, 0.5 px, 15 s window (`weak-periodicity`).

### Verdict (primary (lk-*), 7280 windows)

| Criterion | Value | Threshold | Result |
|---|---|---|---|
| MAE, 30/60 s windows | 0.16 bpm | ≤ 1.00 bpm | PASS |
| MAE, 15 s windows | 0.95 bpm | ≤ 2.00 bpm | PASS |
| Within ±2 bpm | 100.0 % | ≥ 98.0 % | PASS |
| Within ±4 bpm | 100.0 % | ≥ 100.0 % | PASS |
| Under-count beyond −4 bpm | 0 | ≤ 0 | PASS |
| Label agreement (getRateStatus) | 98.0 % | ≥ 100.0 % | FAIL |
| High → Normal | 0 | ≤ 0 | PASS |
| Correct abstain | 100.0 % | ≥ 90.0 % | PASS |
| False abstain on good windows (primary) | 5.8 % | ≤ 25.0 % | PASS |

### Summary

- Windows: 7280, accepted 4881, abstained 2399 (33.0 %)
- MAE: 15 s 0.95, 30 s 0.23, 60 s 0.02 bpm
- Bias -0.15 bpm, SD 0.99, limits of agreement -2.08 to 1.78 bpm
- Within ±2: 100.0 %; within ±4: 100.0 %; under-count beyond −4: 0
- Label agreement 98.0 %; High → Normal 0
- Correct abstain 100.0 %; false abstain (primary) 5.8 %

| Quality bucket | Windows | Abstained |
|---|---|---|
| [0.0, 0.2) | 1 | 1 |
| [0.2, 0.4) | 296 | 296 |
| [0.4, 0.6) | 831 | 831 |
| [0.6, 0.8) | 791 | 730 |
| [0.8, 1.0] | 5361 | 541 |

### Breakdowns (all methods)

#### By Method

| Method | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| lk-edge | 3640 | 2381 | 34.6 % | 0.61 bpm |
| lk-interior | 3640 | 2500 | 31.3 % | 0.60 bpm |
| profile-edge | 3640 | 855 | 76.5 % | 0.54 bpm |

#### By ROI placement

| ROI placement | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| edge | 7280 | 3236 | 55.5 % | 0.59 bpm |
| interior | 3640 | 2500 | 31.3 % | 0.60 bpm |

#### By Window (s)

| Window (s) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 15 | 6240 | 3206 | 48.6 % | 0.94 bpm |
| 30 | 3120 | 1688 | 45.9 % | 0.23 bpm |
| 60 | 1560 | 842 | 46.0 % | 0.02 bpm |

#### By Group

| Group | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| core | 7140 | 3374 | 52.7 % | 0.50 bpm |
| nuisance | 3150 | 2362 | 25.0 % | 0.73 bpm |
| refusal | 630 | 0 | 100.0 % | n/a |

#### By Amplitude (px)

| Amplitude (px) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 0 | 630 | 0 | 100.0 % | n/a |
| 0.3 | 1428 | 314 | 78.0 % | 0.51 bpm |
| 0.5 | 1428 | 616 | 56.9 % | 0.52 bpm |
| 1 | 4578 | 3044 | 33.5 % | 0.68 bpm |
| 2 | 1428 | 931 | 34.8 % | 0.49 bpm |
| 4 | 1428 | 831 | 41.8 % | 0.50 bpm |

#### By Shake (px rms)

| Shake (px rms) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 0 | 2100 | 1050 | 50.0 % | 0.51 bpm |
| 0.5 | 4935 | 3500 | 29.1 % | 0.65 bpm |
| 1 | 2100 | 1186 | 43.5 % | 0.50 bpm |
| 3 | 1785 | 0 | 100.0 % | n/a |

#### By Rate (bpm)

| Rate (bpm) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 8 | 420 | 0 | 100.0 % | n/a |
| 12 | 420 | 96 | 77.1 % | 0.01 bpm |
| 18 | 1470 | 860 | 41.5 % | 1.10 bpm |
| 24 | 420 | 216 | 48.6 % | 0.01 bpm |
| 28 | 420 | 221 | 47.4 % | 0.02 bpm |
| 29 | 420 | 215 | 48.8 % | 0.85 bpm |
| 30 | 2100 | 1066 | 49.2 % | 1.08 bpm |
| 31 | 420 | 224 | 46.7 % | 0.87 bpm |
| 32 | 420 | 222 | 47.1 % | 0.02 bpm |
| 33 | 420 | 224 | 46.7 % | 0.84 bpm |
| 34 | 420 | 223 | 46.9 % | 1.14 bpm |
| 35 | 420 | 224 | 46.7 % | 0.86 bpm |
| 36 | 1470 | 1067 | 27.4 % | 0.08 bpm |
| 37 | 420 | 229 | 45.5 % | 0.84 bpm |
| 48 | 420 | 222 | 47.1 % | 0.03 bpm |
| 60 | 420 | 223 | 46.9 % | 0.03 bpm |
| 80 | 420 | 204 | 51.4 % | 0.05 bpm |

#### By Contrast

| Contrast | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 10 | 525 | 108 | 79.4 % | 0.50 bpm |
| 20 | 210 | 0 | 100.0 % | n/a |
| 40 | 10185 | 5628 | 44.7 % | 0.60 bpm |

#### By Flicker

| Flicker | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 0.5 Hz / 2 % | 315 | 252 | 20.0 % | 0.76 bpm |
| 10 Hz / 3 % | 315 | 251 | 20.3 % | 0.76 bpm |
| 100 Hz / 5 % | 315 | 247 | 21.6 % | 0.74 bpm |
| none | 9975 | 4986 | 50.0 % | 0.57 bpm |

#### By Purr

| Purr | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 25 Hz / 0.3 px | 315 | 264 | 16.2 % | 0.73 bpm |
| none | 10605 | 5472 | 48.4 % | 0.59 bpm |

#### By Twitches

| Twitches | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 0 | 10605 | 5501 | 48.1 % | 0.59 bpm |
| 2 | 315 | 235 | 25.4 % | 0.75 bpm |

#### By Rate ramp (bpm)

| Rate ramp (bpm) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 0 | 10605 | 5485 | 48.3 % | 0.59 bpm |
| 6 | 315 | 251 | 20.3 % | 0.73 bpm |

#### By Frame rate

| Frame rate | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 24 | 315 | 255 | 19.0 % | 0.74 bpm |
| 30 | 10290 | 5231 | 49.2 % | 0.58 bpm |
| 60 | 315 | 250 | 20.6 % | 0.70 bpm |


## 6. Aliasing

Any periodic motion within ±1.5 Hz of a multiple of the frame rate lands in the breathing band
after sampling, and no 1-D signal processing can tell it from breathing:

| Frame rate | In-band trap (Hz) | 25 Hz purr lands at | 100 Hz flicker | 120 Hz flicker |
|---|---|---|---|---|
| 24 fps | 22.5–25.5, 46.5–49.5 | 1.0 Hz = 60 bpm (in band) | 4 Hz | DC |
| 30 fps | 28.5–31.5, 58.5–61.5 | 5 Hz → `fast-motion` | 10 Hz | DC |
| 60 fps | 58.5–61.5 | 25 Hz → `fast-motion` | 20 Hz | DC |

What the gates guarantee: breathing-dominant → correct; equal amplitudes → abstain (the
estimators disagree: FFT sees the purr, the autocorrelation the breathing); purr-dominant at
24 fps → accepted as 60 bpm, a documented limit (`estimate.test.ts` pins it); at 30 fps the
purr aliases to 5 Hz and `fast-motion` fires. Hence the protocol mandates 30 fps and the CLI
warns below 28. Rolling-shutter row skew is a possible real-camera cue for the 24 fps case; out
of scope here.

## 7. Recording protocol

Sidecar `clips/<clip>.csv`, header required: `clip,counter,breath_timestamp_s` — one row per
breath (inhale onset) per counter, seconds from clip start, ≥ 0.1 s resolution, `counter` a
label (`A`, `B`, `C`). Two counters mark the timestamps from the clip in slow motion; windows
where they agree within one breath per 30 s take the mean, otherwise a third counter decides
(median) or the window is discarded. Clips and sidecars stay in `clips/` (git-ignored).

Recording: phone propped (never hand-held), lateral flank view, 60–90 s, **30 fps** (not 24,
see §6), exposure and focus locked if the camera app allows, no flickering light source in
frame; conditions daylight / LED / dim; ≥ 2 cats including a dark or uniform coat, ≥ 1 dog if
possible; sleeping and resting; note coat, lighting and distance; ROI on the chest/flank edge
chosen from `--dump-frame`; the background strip must show static scene only.

## 8. Real-recording results

None yet. `score` fills one row per clip; the verdict is decided over all clips together.

| Clip | Animal, coat, light | Windows (agreed) | Accepted | MAE | Within ±2 | Label agreement | High→Normal | Reasons when abstaining |
|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — |

## 9. Go/no-go (conditional)

**Synthetic: eight of nine criteria PASS; label agreement FAILS at 98.0 % against 100 %**, and
§5 shows the whole 2 % to be the 30 s quantum straddling a ceiling at exactly 31 and 35 bpm
(largest error 1.04 bpm, no High → Normal, no flip at 60 s). As registered, that is not a clean
pass; whether it is a go to the recording step is a judgement call for the repo owner, with
the author's recommendation being yes, on the condition that the product shape uses 60 s
windows whenever the reading sits within 1 bpm of a ceiling. A synthetic go is a go to the
recording step only. **Real: decided when ≥ 20 accepted windows from ≥ 2 animals (one dark
coat) exist.** Any accepted High→Normal is a no-go regardless of averages; a false-abstain rate
above 25 % on propped-phone clips is a no-go for the product shape below.

Product shape if go: a suggestion that the owner confirms, never auto-saved, never the default,
labelled experimental, ≥ 30 s, optional simultaneous taps. Prerequisites before any app code:
`source: 'camera'` in `src/types/index.ts`, the `backup.ts` source handling, `shareCodec`
rejection of unknown sources, a trend-baseline policy for camera readings, the manifest
`CAMERA` permission with `uses-feature required=false`, a README privacy paragraph, and the
Play data-safety form.

## 10. Prior art

- Angelucci et al., Sci Rep 2025 — 27 sleeping dogs, owners' phones, 20 px ROI, 25 tracked
  points, lateral LoA ±2.17 bpm, RMSE 1.1. <https://www.nature.com/articles/s41598-025-25305-9>
  (clips request-only).
- Grado et al., JSAP 2025 — humans counting ICU cats and dogs from camera feeds read
  2.5–2.9 bpm lower than bedside. <https://pmc.ncbi.nlm.nih.gov/articles/PMC12593288/>
- Balakrishnan et al., CVPR 2013 — tracked-point PCA for pulse from head motion, the combiner
  used here. <https://people.csail.mit.edu/balakg/pulsefromheadmotion.html>
- Infant benchmarks AIR-125/400 (<https://arxiv.org/abs/2307.13110>,
  <https://arxiv.org/abs/2512.06888>); NICU optical flow
  (<https://pmc.ncbi.nlm.nih.gov/articles/PMC11573411/>); CalibrationPhys
  (<https://arxiv.org/pdf/2310.15043>); InsectEye pilot
  (<https://www.mdpi.com/2306-7381/13/8/781>).
- Code: jsfeat (<https://github.com/inspirit/jsfeat>), resPyre
  (<https://github.com/phuselab/resPyre>); product: PawBeat
  (<https://apps.apple.com/us/app/pawbeat-pet-breathing-rate/id6782558499>).
- No public pet dataset with respiration ground truth exists.

## 11. Deferred and known limits

- Variable-frame-rate recordings are resampled by ffmpeg's `fps` filter; not validated.
- Panting (> 90 bpm) is above the band and reads as `fast-motion`; by design, not a reading.
- Auto-exposure is cancelled as a whole-frame gain only; a shadow moving across the ROI is not.
- `maxResidual = 10` (occlusion guard) never fires on synthetic scenes and is uncalibrated on
  real fur. The `twitch` gate is tested on 1-D input only; a Lucas-Kanade twitch shows up as a
  validity dip (the jumped points fail to track and hold their last value) rather than as an
  outlier in the combined signal, so the gate is not what refuses those windows.
- The profile method reads vertical motion only (it abstains on a rotated clip whose breathing
  is horizontal) and accepts roughly half of the good windows: a cross-check, never a fallback.
- No Python, no learned models; everything here would run in the WebView.
- The website variant sends `Permissions-Policy: camera=()` (`nginx.conf`), which would have to
  change for a browser-based capture.
