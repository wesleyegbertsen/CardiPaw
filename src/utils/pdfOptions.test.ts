import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  CHART_HEIGHT_PX,
  CHART_PIXEL_RATIO,
  CHART_WIDTH_PX,
  PDF_DOC_OPTIONS,
} from './pdfOptions';

const W = CHART_WIDTH_PX * CHART_PIXEL_RATIO;
const H = CHART_HEIGHT_PX * CHART_PIXEL_RATIO;

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An RGBA PNG like the chart canvas: transparent, with a coloured line and a flat line. */
function chartLikePng(): string {
  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H); // filter 0, fully transparent
  for (let y = 0; y < H; y++) {
    const line = [Math.round(W / 2 + Math.sin(y / 20) * (W / 4)), Math.round(H / 3)];
    for (const x of line) {
      for (let d = -3; d <= 3; d++) {
        const o = y * stride + 1 + (x + d) * 4;
        raw[o] = 224; raw[o + 1] = 92; raw[o + 2] = 122; raw[o + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

function pdfWithChart(options: ConstructorParameters<typeof jsPDF>[0]): string {
  const doc = new jsPDF(options);
  doc.addImage(chartLikePng(), 'PNG', 14, 30, 182, 64);
  return doc.output();
}

describe('PDF size budget', () => {
  it('keeps a one-chart report under 200 KB, as FlateDecode images at the fixed size', () => {
    const pdf = pdfWithChart({ ...PDF_DOC_OPTIONS });
    expect(pdf).toContain(`/Width ${W}`);
    expect(pdf).toContain(`/Height ${H}`);
    expect(pdf).toContain('/FlateDecode');
    expect(pdf.length).toBeLessThan(200 * 1024);
  });

  it('would be far over that without compression (so the test notices a jsPDF change)', () => {
    const pdf = pdfWithChart({ ...PDF_DOC_OPTIONS, compress: false });
    expect(pdf.length).toBeGreaterThan(3 * W * H);
  });
});
