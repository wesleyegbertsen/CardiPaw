// Shared types for the motion extractors (profile cross-correlation, Lucas-Kanade). Pure
// module: ES2020 only, no Node built-ins.

/** One 8-bit grey frame, row-major. */
export interface Frame {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A rectangle in frame pixels. */
export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What an extractor learned about its own footing; estimate() turns these into reasons. */
export interface MotionQuality {
  borderRms?: number; // band-passed rms of the background motion, px: camera shake
  validTrackRatio?: number; // valid / total tracked points
  amplitudePx?: number; // band-passed rms of the signal itself, px
}

/** An extractor's output. The signal is UNFILTERED: estimate() detrends and band-passes it. */
export interface MotionSignal {
  signal: Float64Array;
  quality: MotionQuality;
}
