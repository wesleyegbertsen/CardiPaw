// Argument builders, probe parsing and frame slicing only: nothing here spawns ffmpeg.
import { describe, expect, it } from 'vitest';
import {
  decodeArgs,
  displayedSize,
  encodeArgs,
  ffmpegMissingHint,
  parseProbe,
  probeArgs,
  sliceFrames,
  workingSize,
  writePgm,
} from './ingest.ts';

const probeJson = (stream: Record<string, unknown>) =>
  JSON.stringify({ programs: [], stream_groups: [], streams: [stream] });
const STREAM = { width: 1920, height: 1080, r_frame_rate: '30/1', duration: '61.500000' };

describe('ffmpeg arguments', () => {
  it('decodeArgs pins fps and an aspect-preserving size', () => {
    const args = decodeArgs('clip.mp4', { fps: 30, width: 320, height: 180 });
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf.startsWith('fps=30,')).toBe(true);
    expect(vf).toContain('scale=320:180:force_original_aspect_ratio=decrease');
    expect(vf).toContain('pad=320:180:');
    expect(args.slice(-6)).toEqual(['-f', 'rawvideo', '-pix_fmt', 'gray', '-an', '-']);
    expect(args[args.indexOf('-i') + 1]).toBe('clip.mp4');
  });

  it('encodeArgs declares the raw size and rate before -i', () => {
    const args = encodeArgs('out.mp4', { fps: 24, width: 192, height: 144 });
    const i = args.indexOf('-i');
    expect(args[i + 1]).toBe('-');
    expect(args.slice(0, i)).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe('192x144');
    expect(args.indexOf('-s')).toBeLessThan(i);
    expect(args[args.indexOf('-r') + 1]).toBe('24');
    expect(args.indexOf('-r')).toBeLessThan(i);
    expect(args[args.indexOf('-crf') + 1]).toBe('28');
    expect(encodeArgs('o.mp4', { fps: 30, width: 2, height: 2, crf: 18 })).toContain('18');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('probeArgs asks for the rotation side data as JSON', () => {
    const args = probeArgs('clip.mp4');
    expect(args[args.indexOf('-show_entries') + 1]).toContain('stream_side_data=rotation');
    expect(args[args.indexOf('-of') + 1]).toBe('json');
    expect(args[args.length - 1]).toBe('clip.mp4');
  });
});

describe('sliceFrames', () => {
  it('splits 3 frames of 4×2', () => {
    const buf = Uint8Array.from({ length: 24 }, (_, i) => i);
    const frames = sliceFrames(buf, 4, 2);
    expect(frames).toHaveLength(3);
    expect(frames[1]).toMatchObject({ width: 4, height: 2 });
    expect(Array.from(frames[1].data)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(Array.from(frames[2].data)).toEqual([16, 17, 18, 19, 20, 21, 22, 23]);
  });

  it('throws naming the frame size', () => {
    expect(() => sliceFrames(new Uint8Array(23), 4, 2)).toThrow(
      '23 bytes, not a multiple of 4×2 = 8',
    );
  });
});

describe('parseProbe', () => {
  it('reads "30000/1001" as 29.97 and the duration', () => {
    const p = parseProbe(probeJson({ ...STREAM, r_frame_rate: '30000/1001' }));
    expect(p.fps).toBeCloseTo(29.97, 2);
    expect(p).toMatchObject({ width: 1920, height: 1080, seconds: 61.5 });
  });

  it('missing side data → rotation 0, [{rotation: 90}] → 90', () => {
    expect(parseProbe(probeJson(STREAM)).rotation).toBe(0);
    expect(parseProbe(probeJson({ ...STREAM, side_data_list: [{ rotation: 90 }] })).rotation).toBe(
      90,
    );
    expect(parseProbe(probeJson({ ...STREAM, side_data_list: [{ rotation: -90 }] })).rotation).toBe(
      -90,
    );
  });

  it('throws naming a missing width, a bad frame rate and an absent stream', () => {
    const { width: _width, ...noWidth } = STREAM;
    expect(() => parseProbe(probeJson(noWidth))).toThrow('streams[0].width');
    expect(() => parseProbe(probeJson({ ...STREAM, r_frame_rate: '30' }))).toThrow('r_frame_rate');
    expect(() => parseProbe(JSON.stringify({ streams: [] }))).toThrow('streams[0]');
  });
});

describe('workingSize', () => {
  it.each([
    [1920, 1080, 0, 320, 180],
    [1920, 1080, 90, 180, 320],
    [1920, 1080, -90, 180, 320],
    [1920, 1080, 180, 320, 180],
    [1000, 1000, 0, 320, 320],
    [192, 144, 0, 192, 144],
  ])('%s×%s rotated %s → %s×%s', (width, height, rotation, w, h) => {
    expect(workingSize({ width, height, rotation })).toEqual({ width: w, height: h });
  });

  it('1280×721 → even numbers, the longest side is configurable, and nothing is upscaled', () => {
    const s = workingSize({ width: 1280, height: 721, rotation: 0 });
    expect(s).toEqual({ width: 320, height: 180 });
    expect(s.width % 2).toBe(0);
    expect(s.height % 2).toBe(0);
    expect(workingSize({ width: 1280, height: 720, rotation: 0 }, 192)).toEqual({
      width: 192,
      height: 108,
    });
    expect(workingSize({ width: 4000, height: 10, rotation: 0 })).toEqual({
      width: 320,
      height: 2,
    });
  });

  it('displayedSize swaps only for ±90°', () => {
    expect(displayedSize({ width: 4, height: 3, rotation: 270 })).toEqual({ width: 3, height: 4 });
    expect(displayedSize({ width: 4, height: 3, rotation: 180 })).toEqual({ width: 4, height: 3 });
  });
});

describe('writePgm and hints', () => {
  it('writePgm header', () => {
    const out = writePgm({ width: 3, height: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) });
    const header = 'P5\n3 2\n255\n';
    expect(Buffer.from(out.subarray(0, header.length)).toString('latin1')).toBe(header);
    expect(out.length).toBe(header.length + 6);
    expect(Array.from(out.subarray(header.length))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ffmpegMissingHint names ffmpeg for ENOENT only', () => {
    expect(
      ffmpegMissingHint(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })),
    ).toContain('ffmpeg');
    expect(ffmpegMissingHint(new Error('other'))).toBeNull();
    expect(ffmpegMissingHint(null)).toBeNull();
  });
});
