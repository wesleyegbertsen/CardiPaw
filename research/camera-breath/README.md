# Camera-based breath counting (research)

Prototype for estimating a pet's breathing rate from a propped-phone video, exploring
[#130](https://github.com/wesleyegbertsen/CardiPaw/issues/130). The signal chain lives in `src/camera/`
and is used by the app's experimental camera counting (opt-in, see the main README); this
folder keeps the CLI, the sweep and the scoring.

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
  fence keeps every Node built-in out of the pure modules, which moved into the app as `src/camera/`).

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
node research/camera-breath/run.ts synth --seeds 3 --encode        # core sweep (1,134 cells) through libx264, ~42 min
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

### What was run

`run.ts synth --subset core --seeds 3 --encode`, on 2026-11-04 with Node v24.22.1 and ffmpeg
8.0.1 (gyan.dev essentials build), every cell round-tripped through libx264 at CRF 28, 2,513 s
wall. The code was the tree at `3c9ddd4` (the sweep records `77fb3fd`, the branch head when it
finished; the commits in between touch the CLI, the tests and this note, not the signal chain,
the gates or the renderer). The JSON and the generated tables are in `out/` (git-ignored).

The population, stated exactly:

- **1,020 core cells**: 17 rates (8–80 bpm) × 5 amplitudes (0.3–4 px) × 4 shake levels
  (0–3 px rms) × seeds 1, 2, 3 — **30 fps only**, contrast 40.
- **90 nuisance cells**: 10 variants (contrast 10 and 40, three flickers, a 0.3 px purr, two
  twitches, 24 fps, 60 fps, a +6 bpm ramp) × 18/30/36 bpm × 3 seeds, all at A = 1 px and 0.5 px
  shake. **24 and 60 fps occur only here**, 9 cells each; nothing else in the sweep tests the
  frame rate.
- **24 refusal cells**: no breathing (A = 0) at contrast 10/20/40 × shake 0/1, and in-band
  0.5 Hz / 2 % flicker at A = 0.3 and 0.5 px, × 3 seeds.

Every cell is 60 s at 192×144 and gets three extractions (lk-edge, lk-interior, profile-edge)
and seven non-overlapping windows (4 × 15 s, 2 × 30 s, 1 × 60 s): 23,814 windows, 15,876 on
the primary method. The verdict and every number below are **primary-method (Lucas-Kanade,
both ROI placements) unless a table says otherwise**; the profile method appears in the method
table only.

What is independent here: a seed fixes the texture, the pixel-noise stream and the shake/drift
path, so the seven windows of a cell and the two LK ROIs on the same frames are correlated, and
the three seeds are the number of independent scenes per grid point, not 14. The window counts
are large because the grid is dense, not because the evidence is; per-seed figures are given
where they matter.

### The verdict

The sweep exited 1: **eight criteria pass, label agreement fails** (97.3 % against the
pre-registered 100 %).

All 117 label flips are 30 s windows at exactly 31 bpm read as 30 (81, Elevated → Normal;
15.5 breaths round either way) and exactly 35 bpm read as 36 (36, Elevated → High; 17.5
breaths): 81 of the 166 accepted 30 s windows at 31 bpm flip, 36 of 166 at 35 bpm, and
nothing else flips. The largest error among them is 1.00 bpm, i.e. the 30 s quantum; none is
High → Normal; per seed the agreement is 97.1 / 97.9 / 96.9 %. No 60 s window flips, but that
holds only because the grid holds integer rates: a real animal at 30.4 bpm flips at 60 s too.
Any whole-breath count, tapped or camera, flips within half a quantum of a ceiling, so this is
the quantum of the window meeting a ceiling, not a bias of the method (bias −0.18 bpm over all
accepted windows, 30/60 s MAE 0.19). The 100 % threshold did not anticipate rates sitting
exactly one bpm above a ceiling. It still fails as registered. The honest reading: on 30 s
windows the label is reliable except within ±1 bpm of a ceiling, where only a longer window or
a second reading decides.

### Other findings (primary method)

- **Good windows and false abstains.** A _good_ window is one from a cell with A ≥ 0.5 px,
  shake ≤ 1 px rms and no in-band flicker, except the 15 s windows at ≤ 12 bpm, which hold fewer
  than three cycles and are too-short by design (576 windows, left out). False abstains: 4.8 %
  (437 of 9,126; per seed 4.5 / 4.6 / 5.2 %). By rate: 8 bpm 216 of 216 — 8 bpm is 0.133 Hz,
  below the 0.15 Hz band edge, a design floor rather than an estimator weakness (0 of 216
  windows accepted at A ≥ 1 over 30/60 s; see §11 on large dogs); 12 bpm 59 of 216 (27 %,
  `irregular` and `estimators-disagree`; at A ≥ 1 it reads on 102 of 144 30 s windows and 51 of
  72 60 s windows); 18 bpm 72 of 882 (8 %). Above 24 bpm the rate is 1.2 % (88 of 7,308), of
  which the contrast-10 nuisance cells supply 41 (they abstain on 65 % of their 126 windows);
  without them 0.7 %. Edge and interior placements abstain alike (243 and 194 of 4,563 each).
- **Refusal.** 3,845 of the 3,906 windows that should abstain did (98.4 %). No breathing: 0 of
  252 accepted. 3 px shake: 0 of 3,570 accepted. The third registered condition, in-band
  0.5 Hz / 2 % flicker over a 0.3 or 0.5 px signal, is where all 61 accepted windows sit — and
  they are correct readings (MAE 1.1 bpm, largest error 2.0 = the 15 s quantum; 41 of 42
  accepted at 0.5 px, 20 of 42 at 0.3 px). The whole-frame gain cancellation removes the
  flicker before the estimators see it, exactly as at A = 1 (126 of 126 accepted, MAE 0.76).
  The registration predicted that in-band flicker would corrupt a tiny signal; it does not. The
  criterion passes as registered (≥ 90 %), but the right statement is that this refusal
  condition was mis-specified, not that the method refused it; on the two conditions that
  really have nothing to read, refusal is 100 %.
- **Detection floors** (core cells, shake ≤ 1 px): 0.3 px abstains on 54.7 % of windows,
  0.5 px on 15.0 %, 1/2/4 px on 7.8/7.5/7.8 % (that residual is the 8/12/18 bpm rows); the
  accepted windows are accurate at every amplitude (MAE 0.49–0.50). Lucas-Kanade therefore
  reads down to about 0.5 px at 192×144, with the abstain rate as the signal that it is
  marginal. Shake 0 / 0.5 / 1 px at A ≥ 1 abstain on 7.4 / 8.0 / 7.8 %; 3 px on 100 %.
- **Window length** (good windows): 15 s MAE 0.80 bpm, largest error 2.00 (the quantum);
  30 s MAE 0.29, largest 1.00; 60 s MAE 0.00 to two decimals, largest 1.00. Before
  quantisation the raw estimate is off by 0.09 / 0.04 / 0.02 bpm on average and at most
  1.07 / 0.98 / 0.62: the reported error is the grid, not the estimator.
- **Nuisances** (A = 1, 0.5 px shake, 18/30/36 bpm, three seeds): 10 and 100 Hz flicker, the
  in-band 0.5 Hz flicker, a 0.3 px purr, two twitches, a +6 bpm ramp, 24 and 60 fps all stay
  at 0–1.6 % abstain and MAE ≤ 0.76 bpm on the primary method (the table below). Pooled over
  all three methods the nuisance cells abstain on 24.8 %, which is the profile method. Contrast
  10 is the one nuisance that costs: 65 % abstain, the accepted windows accurate (MAE 0.41).
- **Gates.** `twitch` fired on 39 windows, 38 of them in 3 px shake cells, never as the only
  reason and never on a good window; on the two-twitch nuisance cells `twitchFraction` is
  0.000, because Lucas-Kanade turns a 15 px jump into a validity dip (the jumped points fail to
  track and hold) that the 1-D gate never sees. `low-quality` fired on 11 windows, 10 of them
  at 0.3 px (quality 0.68–0.70); every abstain carries at least one reason.
- **Seeds agree**: label agreement 97.1 / 97.9 / 96.9 %, false abstain 4.5 / 4.6 / 5.2 %,
  30/60 s MAE 0.196 / 0.191 / 0.194 bpm for seeds 1 / 2 / 3.
- The smoke subset (14 cells, seed 1, encoded) passes all nine criteria; its only false abstain
  is an 18 bpm, 0.5 px, 15 s window (`weak-periodicity`).

### Verdict (primary (lk-*), 15876 windows)

| Criterion | Value | Threshold | Result |
|---|---|---|---|
| MAE, 30/60 s windows | 0.19 bpm | ≤ 1.00 bpm | PASS |
| MAE, 15 s windows | 0.79 bpm | ≤ 2.00 bpm | PASS |
| Within ±2 bpm | 100.0 % | ≥ 98.0 % | PASS |
| Within ±4 bpm | 100.0 % | ≥ 100.0 % | PASS |
| Under-count beyond −4 bpm | 0 | ≤ 0 | PASS |
| Label agreement (getRateStatus) | 97.3 % | ≥ 100.0 % | FAIL |
| High → Normal | 0 | ≤ 0 | PASS |
| Correct abstain | 98.4 % | ≥ 90.0 % | PASS |
| False abstain on good windows (primary) | 4.8 % | ≤ 25.0 % | PASS |

### Summary (primary)

- Windows: 15876, accepted 9957, abstained 5919 (37.3 %; the refusal and 3 px shake cells
  and the 0.3 px floor make up most of it)
- MAE: 15 s 0.79, 30 s 0.29, 60 s 0.00 bpm
- Bias −0.18 bpm, SD 0.88, limits of agreement −1.90 to 1.54 bpm (pooled over window lengths,
  so dominated by the 15 s quantum)
- Within ±2: 100.0 %; within ±4: 100.0 %; under-count beyond −4: 0
- Label agreement 97.3 %; High → Normal 0
- Correct abstain 98.4 %; false abstain (primary) 4.8 %

| Quality bucket | Windows | Abstained |
|---|---|---|
| [0.2, 0.4) | 266 | 266 |
| [0.4, 0.6) | 2068 | 2068 |
| [0.6, 0.8) | 2170 | 2018 |
| [0.8, 1.0] | 11372 | 1567 |

### Breakdowns

Primary method only unless the heading says otherwise; abstain rates and MAE over the windows
named in the heading.

#### By method (all three extractions)

| Method | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| lk-edge | 7938 | 4794 | 39.6 % | 0.53 bpm |
| lk-interior | 7938 | 5163 | 35.0 % | 0.53 bpm |
| profile-edge | 7938 | 2558 | 67.8 % | 0.51 bpm |

#### By window length

| Window (s) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 15 | 9072 | 5598 | 38.3 % | 0.79 bpm |
| 30 | 4536 | 2904 | 36.0 % | 0.29 bpm |
| 60 | 2268 | 1455 | 35.8 % | 0.00 bpm |

#### By group

| Group | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| core | 14280 | 8721 | 38.9 % | 0.50 bpm |
| nuisance | 1260 | 1175 | 6.7 % | 0.74 bpm |
| refusal | 336 | 61 | 81.8 % | 1.11 bpm |

#### By amplitude, core cells with shake ≤ 1 px

| Amplitude (px) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 0.3 | 2142 | 971 | 54.7 % | 0.50 bpm |
| 0.5 | 2142 | 1821 | 15.0 % | 0.50 bpm |
| 1 | 2142 | 1974 | 7.8 % | 0.49 bpm |
| 2 | 2142 | 1981 | 7.5 % | 0.49 bpm |
| 4 | 2142 | 1974 | 7.8 % | 0.49 bpm |

#### By shake, core cells with A ≥ 1 px

| Shake (px rms) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 0 | 2142 | 1984 | 7.4 % | 0.49 bpm |
| 0.5 | 2142 | 1970 | 8.0 % | 0.49 bpm |
| 1 | 2142 | 1975 | 7.8 % | 0.49 bpm |
| 3 | 2142 | 0 | 100.0 % | n/a |

#### By rate, good windows of the core cells

The MAE alternates between 0 and ~0.9–1.1 bpm with the rate because an odd number of breaths
in 30 s and a non-multiple of 4 in 15 s sit between grid points; it is the quantum, not the
estimator (see the raw-estimate figures above).

| Rate (bpm) | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| 8 | 216 | 0 | 100.0 % | n/a |
| 12 | 216 | 157 | 27.3 % | 0.00 bpm |
| 18 | 504 | 476 | 5.6 % | 1.13 bpm |
| 24 | 504 | 502 | 0.4 % | 0.00 bpm |
| 28 | 504 | 499 | 1.0 % | 0.00 bpm |
| 29 | 504 | 501 | 0.6 % | 0.86 bpm |
| 30 | 504 | 502 | 0.4 % | 1.14 bpm |
| 31 | 504 | 499 | 1.0 % | 0.86 bpm |
| 32 | 504 | 501 | 0.6 % | 0.00 bpm |
| 33 | 504 | 501 | 0.6 % | 0.86 bpm |
| 34 | 504 | 500 | 0.8 % | 1.14 bpm |
| 35 | 504 | 502 | 0.4 % | 0.86 bpm |
| 36 | 504 | 503 | 0.2 % | 0.00 bpm |
| 37 | 504 | 502 | 0.4 % | 0.86 bpm |
| 48 | 504 | 502 | 0.4 % | 0.00 bpm |
| 60 | 504 | 501 | 0.6 % | 0.00 bpm |
| 80 | 504 | 492 | 2.4 % | 0.00 bpm |

#### Nuisance cells (A = 1 px, 0.5 px shake, 18/30/36 bpm, three seeds)

| Variant | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| none (contrast 40) | 126 | 126 | 0.0 % | 0.76 bpm |
| contrast 10 | 126 | 44 | 65.1 % | 0.41 bpm |
| flicker 0.5 Hz / 2 % (in band) | 126 | 126 | 0.0 % | 0.76 bpm |
| flicker 10 Hz / 3 % | 126 | 126 | 0.0 % | 0.76 bpm |
| flicker 100 Hz / 5 % | 126 | 126 | 0.0 % | 0.76 bpm |
| purr 25 Hz / 0.3 px | 126 | 124 | 1.6 % | 0.74 bpm |
| 2 twitches | 126 | 126 | 0.0 % | 0.76 bpm |
| 24 fps | 126 | 126 | 0.0 % | 0.76 bpm |
| 60 fps | 126 | 125 | 0.8 % | 0.75 bpm |
| rate ramp +6 bpm | 126 | 126 | 0.0 % | 0.71 bpm |

#### Refusal cells (30 bpm, 30 fps, three seeds)

| Cell | Windows | Accepted | Abstain rate | MAE (accepted) |
|---|---|---|---|---|
| no breathing, contrast 10, shake 0 | 42 | 0 | 100.0 % | n/a |
| no breathing, contrast 10, shake 1 | 42 | 0 | 100.0 % | n/a |
| no breathing, contrast 20, shake 0 | 42 | 0 | 100.0 % | n/a |
| no breathing, contrast 20, shake 1 | 42 | 0 | 100.0 % | n/a |
| no breathing, contrast 40, shake 0 | 42 | 0 | 100.0 % | n/a |
| no breathing, contrast 40, shake 1 | 42 | 0 | 100.0 % | n/a |
| in-band flicker 0.5 Hz / 2 %, A = 0.3 | 42 | 20 | 52.4 % | 1.10 bpm |
| in-band flicker 0.5 Hz / 2 %, A = 0.5 | 42 | 41 | 2.4 % | 1.12 bpm |

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

Counting: the two counters work blind — each marks the timestamps before seeing the other's
sheet and before anyone runs `analyse` or `score` on the clip, so neither the detector's output
nor the other count can steer a decision about a doubtful breath.

Degraded clips: besides the good clips, record at least one clip per degraded condition —
hand-held, dim light, 24 fps — and score each with `--degraded`; those are the only real data
behind the "correct abstain" criterion, which the good clips cannot test.

What the clips can and cannot decide: a resting cat or dog rarely exceeds 35 bpm, so the
label-agreement and High → Normal criteria are vacuous unless an animal with an elevated rate
is recorded (a cat after play, a dog on a warm day, or a patient whose vet has asked for
counts); the write-up reports those criteria on whatever range the clips cover and says so.
Sample size: ≥ 40 agreed windows from ≥ 3 animals is the comfortable bar; ≥ 20 from ≥ 2 (one
dark coat) is the minimum, and windows from one clip are correlated, so 18 of 20 is a wide
confidence interval, not 90 %.

## 8. Real-recording results

None yet. `score` fills one row per clip; the verdict is decided over all clips together.

| Clip | Animal, coat, light | Windows (agreed) | Accepted | MAE | Within ±2 | Label agreement | High→Normal | Reasons when abstaining |
|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — |

## 9. Go/no-go (conditional)

**Synthetic: eight of nine criteria PASS; label agreement FAILS at 97.3 % against 100 %**, and
§5 shows every one of the 117 flips to be the 30 s quantum straddling a ceiling at exactly 31
and 35 bpm (largest error 1.00 bpm, no High → Normal; no flip at 60 s, which an integer-rate
grid guarantees and a real 30.4 bpm animal would not). As registered, that is not a clean
pass; whether it is a go to the recording step is a judgement call for the repo owner, with
the author's recommendation being yes, on the condition that the product shape uses 60 s
windows whenever the reading sits within 1 bpm of a ceiling. Two caveats travel with that
recommendation: the sweep validates the signal chain and the abstain logic on a rigid rendered
scene, not tracking on fur (§11), and one registered refusal condition turned out to be
mis-specified (§5). A synthetic go is a go to the recording step only. **Real: decided when ≥ 20 agreed windows from ≥ 2 animals (one dark coat)
exist; ≥ 40 from ≥ 3 animals is the comfortable bar (§7).** Any accepted High→Normal is a no-go
regardless of averages; a false-abstain rate above 25 % on propped-phone clips is a no-go for
the product shape below. The High range and the label criteria are only decided if an animal
with an elevated rate is recorded; otherwise they are reported as untested, not as passed.

Product shape if go: a suggestion that the owner confirms, never auto-saved, never the default,
labelled experimental, ≥ 30 s, optional simultaneous taps. Prerequisites before any app code:
`source: 'camera'` in `src/types/index.ts`, the `backup.ts` source handling, `shareCodec`
rejection of unknown sources, a trend-baseline policy for camera readings, the manifest
`CAMERA` permission with `uses-feature required=false`, a README privacy paragraph, and the
Play data-safety form.

Implemented in the app as an opt-in in round 2 (PR #134); the real-recording bar still stands
before it leaves Experimental.

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

- What the synthetic sweep does and does not show. The scene is a rigid body under a wall of
  the same texture statistics, moved by pure translation; the shake is global translation
  with periods of 4–32 frames (0.94–7.5 Hz at 30 fps, at or above the band), which the
  background median cancels exactly; there are no shadows, no repositioning, no local
  deformation, no silhouette-only coat, and the pixel noise is fixed at σ = 4. The sweep
  therefore validates the signal chain (band-pass, estimators, gates, quantisation) and the
  abstain logic, not vision on fur; in-band shake with parallax and a shadow crossing the ROI
  are untested until real clips exist.
- The band starts at 0.15 Hz = 9 bpm. 8 bpm is below it by design (0 of 216 30/60 s windows accepted
  at A ≥ 1 in the core sweep) and 12 bpm reads on most but not all 30/60 s windows. Resting large dogs sit
  at 10–15 bpm, so a product for dogs would need a lower edge (0.1 Hz) — which invalidates the
  gate calibration in §2 and is deferred until there is a dog clip to calibrate on.
- `estimate()` quantises only on the 15/30/60 s grid: a window of 449 or 451 samples at 30 fps
  is off-grid and returns `interval: null` with `quantisedBpm = round(bpm)`. The CLI always
  slices exact multiples; a caller with its own windows must too.
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
- The website's `Permissions-Policy` header allows `camera=(self)` since round 2; the app's WebView
  is not subject to it.
