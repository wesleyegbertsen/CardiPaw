// DOM glue for the camera capture: the frame source, the canvas grey conversion and the
// getUserMedia error mapping. Imported only by useCameraBreath; happy-dom cannot run the
// canvas, so the composable takes these as injectable dependencies.
import { FRAME_HEIGHT, FRAME_WIDTH, coverCrop, greyFromRgba } from './capture.ts';
import type { Frame } from './motion.ts';

/** Calls onFrame once per presented camera frame with a monotonic timestamp in ms; returns stop(). */
export type FrameSource = (
  video: HTMLVideoElement,
  onFrame: (timeMs: number) => void,
) => () => void;

/**
 * requestVideoFrameCallback (Chrome/WebView 83+): one callback per camera frame. mediaTime is
 * the capture clock, but some WebViews leave it at 0 on a live stream, so the second callback
 * decides once, for this source, between it and the callback's own clock (`now`); a capture
 * starts long after that. Elsewhere requestAnimationFrame runs at the display rate, so frames
 * are deduplicated on currentTime and stamped with performance.now().
 */
export const videoFrames: FrameSource = (video, onFrame) => {
  let stopped = false;
  if (typeof video.requestVideoFrameCallback === 'function') {
    let firstMediaTime = -1;
    let mediaClock: boolean | null = null;
    let handle = 0;
    const step = (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
      if (stopped) return;
      if (mediaClock === null) {
        if (firstMediaTime < 0) firstMediaTime = metadata.mediaTime;
        else mediaClock = metadata.mediaTime > firstMediaTime;
      }
      onFrame(mediaClock === false ? now : metadata.mediaTime * 1000);
      handle = video.requestVideoFrameCallback(step);
    };
    handle = video.requestVideoFrameCallback(step);
    return () => {
      stopped = true;
      video.cancelVideoFrameCallback?.(handle);
    };
  }
  let lastTime = -1;
  let handle = 0;
  const step = () => {
    if (stopped) return;
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      onFrame(performance.now());
    }
    handle = requestAnimationFrame(step);
  };
  handle = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
};

/**
 * Draws the centred 4:3 region of the video (what the preview's object-fit: cover shows) into
 * a working-size canvas and returns the grey Frame the tracker reads. The frame never leaves
 * memory: no data URL, no storage, no network.
 */
export function createFrameReader(
  width = FRAME_WIDTH,
  height = FRAME_HEIGHT,
): (video: HTMLVideoElement) => Frame {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  return (video) => {
    const { sx, sy, sw, sh } = coverCrop(video.videoWidth, video.videoHeight, width, height);
    if (sw > 0 && sh > 0) ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    else ctx.drawImage(video, 0, 0, width, height);
    return greyFromRgba(ctx.getImageData(0, 0, width, height).data, width, height);
  };
}

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
  },
  audio: false,
};

export type CameraErrorKind = 'denied' | 'no-camera' | 'busy' | 'failed';

/** What a getUserMedia rejection means to the owner. */
export function cameraErrorKind(e: unknown): CameraErrorKind {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'failed';
}
