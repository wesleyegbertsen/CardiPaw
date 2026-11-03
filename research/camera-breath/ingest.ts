// ffmpeg/ffprobe front end for the CLI: probe a clip, decode it to grey frames at a fixed
// rate and working size, and encode synthetic frames to H.264 so the sweep can measure what
// compression does. Node-only (child processes); the pure modules never import this file.
// Needs ffmpeg 8 (ffmpeg and ffprobe) on PATH.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Frame } from './motion.ts';

export interface ProbeInfo {
  width: number; // stored (pre-rotation) size
  height: number;
  rotation: number; // display rotation in degrees from the container, 0 when absent
  fps: number;
  seconds: number;
}

function field(obj: unknown, name: string, where: string): unknown {
  if (typeof obj !== 'object' || obj === null || !(name in obj)) {
    throw new Error(`ffprobe output has no ${where}.${name}`);
  }
  return (obj as Record<string, unknown>)[name];
}

function numberField(obj: unknown, name: string, where: string): number {
  const v = field(obj, name, where);
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n))
    throw new Error(`ffprobe ${where}.${name} is not a number: ${String(v)}`);
  return n;
}

/** The video stream's size, rotation, frame rate and length from `ffprobe … -of json`. */
export function parseProbe(json: string): ProbeInfo {
  const root: unknown = JSON.parse(json);
  const streams = field(root, 'streams', 'root');
  if (!Array.isArray(streams) || streams.length === 0) {
    throw new Error('ffprobe output has no video stream (streams[0])');
  }
  const s: unknown = streams[0];
  const rate = field(s, 'r_frame_rate', 'streams[0]');
  const m = typeof rate === 'string' ? /^(\d+)\/(\d+)$/.exec(rate) : null;
  if (m === null || Number(m[2]) === 0) {
    throw new Error(`ffprobe streams[0].r_frame_rate is not a/b: ${String(rate)}`);
  }
  let rotation = 0;
  if (typeof s === 'object' && s !== null && 'side_data_list' in s) {
    const list = (s as { side_data_list: unknown }).side_data_list;
    const first: unknown = Array.isArray(list) ? list[0] : undefined;
    if (typeof first === 'object' && first !== null && 'rotation' in first) {
      rotation = numberField(first, 'rotation', 'side_data_list[0]');
    }
  }
  return {
    width: numberField(s, 'width', 'streams[0]'),
    height: numberField(s, 'height', 'streams[0]'),
    rotation,
    fps: Number(m[1]) / Number(m[2]),
    seconds: numberField(s, 'duration', 'streams[0]'),
  };
}

/** The size a player shows: width and height swap for a 90° or 270° display rotation. */
export function displayedSize(p: Pick<ProbeInfo, 'width' | 'height' | 'rotation'>): {
  width: number;
  height: number;
} {
  const swap = Math.abs(p.rotation) % 180 === 90;
  return swap ? { width: p.height, height: p.width } : { width: p.width, height: p.height };
}

const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));

/**
 * The analysis size: the displayed frame scaled down so its longer side is `longest` (never
 * up: that adds no information), each side rounded to an even number (libx264 needs even sizes). Keeping the aspect ratio keeps the
 * decoder's letterbox pad at most one pixel, so the background strip stays real picture.
 */
export function workingSize(
  p: Pick<ProbeInfo, 'width' | 'height' | 'rotation'>,
  longest = 320,
): { width: number; height: number } {
  const d = displayedSize(p);
  const scale = Math.min(1, longest / Math.max(d.width, d.height));
  return { width: even(d.width * scale), height: even(d.height * scale) };
}

/** ffmpeg arguments that decode `clip` to raw 8-bit grey frames at `fps` and exactly w×h. */
export function decodeArgs(
  clip: string,
  o: { fps: number; width: number; height: number },
): string[] {
  const { fps, width: w, height: h } = o;
  // scale keeps the aspect ratio inside w×h; pad centres it on black so every frame is w×h.
  const vf = `fps=${fps},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  return [
    '-loglevel',
    'error',
    '-i',
    clip,
    '-vf',
    vf,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-an',
    '-',
  ];
}

/** ffmpeg arguments that encode raw grey frames from stdin to H.264 (phone-like CRF 28). */
export function encodeArgs(
  out: string,
  o: { fps: number; width: number; height: number; crf?: number },
): string[] {
  const { fps, width: w, height: h } = o;
  return [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-s',
    `${w}x${h}`,
    '-r',
    `${fps}`,
    '-i',
    '-',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    `${o.crf ?? 28}`,
    '-pix_fmt',
    'yuv420p',
    out,
  ];
}

export function probeArgs(clip: string): string[] {
  return [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate,duration:stream_side_data=rotation',
    '-of',
    'json',
    clip,
  ];
}

/** Splits a raw grey stream into frames (views into `buf`, not copies). */
export function sliceFrames(buf: Uint8Array, width: number, height: number): Frame[] {
  const size = width * height;
  if (buf.length % size !== 0) {
    throw new Error(`decoded ${buf.length} bytes, not a multiple of ${width}×${height} = ${size}`);
  }
  const frames: Frame[] = [];
  for (let i = 0; i + size <= buf.length; i += size) {
    frames.push({ width, height, data: buf.subarray(i, i + size) });
  }
  return frames;
}

/** Binary PGM (P5): the simplest image any viewer opens, for reading off ROI pixels. */
export function writePgm(frame: Frame): Uint8Array {
  const header = Buffer.from(`P5\n${frame.width} ${frame.height}\n255\n`, 'latin1');
  return Buffer.concat([header, frame.data]);
}

/** Runs a tool with stdout captured and stderr passed through; rejects on a non-zero exit. */
function run(tool: string, args: string[], input?: Iterable<Uint8Array>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'] });
    const chunks: Buffer[] = [];
    child.stdout!.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(Object.assign(new Error(`${tool} exited with code ${code}`), { code }));
    });
    if (input) {
      const stdin = child.stdin!;
      // The encoder reads slower than frames render: wait for drain instead of buffering a clip.
      (async () => {
        for (const chunk of input) {
          if (!stdin.write(chunk)) await once(stdin, 'drain');
        }
        stdin.end();
      })().catch(reject);
      stdin.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code !== 'EPIPE') reject(e); // EPIPE follows ffmpeg's own error, already reported
      });
    }
  });
}

export async function probe(clip: string): Promise<ProbeInfo> {
  return parseProbe((await run('ffprobe', probeArgs(clip))).toString('utf8'));
}

export async function readFrames(
  clip: string,
  o: { fps: number; width: number; height: number },
): Promise<Frame[]> {
  return sliceFrames(await run('ffmpeg', decodeArgs(clip, o)), o.width, o.height);
}

export async function writeClip(
  frames: Iterable<Frame>,
  out: string,
  o: { fps: number; width: number; height: number; crf?: number },
): Promise<void> {
  function* bytes() {
    for (const f of frames) yield f.data;
  }
  await run('ffmpeg', encodeArgs(out, o), bytes());
}

/** The message to print when ffmpeg or ffprobe could not be started; null for other errors. */
export function ffmpegMissingHint(err: unknown): string | null {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : null;
  return code === 'ENOENT'
    ? 'ffmpeg (or ffprobe) is not on PATH; install ffmpeg 8 and retry'
    : null;
}
