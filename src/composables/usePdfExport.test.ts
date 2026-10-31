import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';
import { usePdfExport } from './usePdfExport';
import { withSetup } from '../test/withSetup';
import { makePet, makeReading } from '../test/fixtures';
import { stubTimezone } from '../test/timezone';
import type { Pet, Reading } from '../types';
import { shareFile } from '../services/nativeFile';
import { mockNative } from '../test/native';

vi.mock('../services/nativeFile', () => ({ shareFile: vi.fn(async () => 'shared') }));

type DocEvent =
  | { type: 'text'; value: string | string[]; page: number }
  | { type: 'addPage' }
  | { type: 'addImage'; data: string; format: string; page: number }
  | { type: 'setFont'; family: string };

const h = vi.hoisted(() => {
  const state = {
    locale: 'en',
    docs: [] as Array<{
      events: DocEvent[];
      saved: string[];
      fonts: string[];
    }>,
    charts: [] as Array<{
      cfg: {
        data: { labels: string[]; datasets: Array<{ data: number[]; label: string }> };
      };
      destroyed: boolean;
    }>,
    failSave: null as Error | null,
    failPhoto: false,
  };
  return state;
});

vi.mock('../i18n', () => ({ currentLocale: () => h.locale }));

vi.mock('chart.js', () => {
  class Chart {
    static register() {}
    record: (typeof h.charts)[number];
    constructor(_canvas: unknown, cfg: (typeof h.charts)[number]['cfg']) {
      this.record = { cfg, destroyed: false };
      h.charts.push(this.record);
    }
    destroy() {
      this.record.destroyed = true;
    }
  }
  return {
    Chart,
    CategoryScale: {},
    LinearScale: {},
    PointElement: {},
    LineElement: {},
    Filler: {},
  };
});

vi.mock('jspdf', () => {
  class jsPDF {
    events: DocEvent[] = [];
    saved: string[] = [];
    fonts: string[] = [];
    pages = 1;
    page = 1;
    fontSize = 16;
    constructor() {
      h.docs.push(this);
    }
    text(value: string | string[]) {
      this.events.push({ type: 'text', value, page: this.page });
    }
    addImage(data: string, format: string) {
      if (h.failPhoto && data.startsWith('data:image/jpeg')) throw new Error('bad image');
      this.events.push({ type: 'addImage', data, format, page: this.page });
    }
    addPage() {
      this.pages += 1;
      this.page = this.pages;
      this.events.push({ type: 'addPage' });
    }
    setPage(n: number) {
      this.page = n;
    }
    getNumberOfPages() {
      return this.pages;
    }
    setFont(family: string) {
      this.events.push({ type: 'setFont', family });
    }
    setFontSize(size: number) {
      this.fontSize = size;
    }
    getFontSize() {
      return this.fontSize;
    }
    getLineHeightFactor() {
      return 1.15;
    }
    splitTextToSize(text: string) {
      return text.split('\n');
    }
    addFileToVFS(name: string) {
      this.fonts.push(name);
    }
    addFont() {}
    setTextColor() {}
    setFillColor() {}
    setDrawColor() {}
    setLineWidth() {}
    rect() {}
    line() {}
    output(type: string) {
      return type === 'datauristring' ? 'data:application/pdf;filename=generated.pdf;base64,JVBERi0=' : '';
    }
    save(name: string) {
      if (h.failSave) throw h.failSave;
      this.saved.push(name);
    }
  }
  return { jsPDF };
});

class FakeImage {
  onload: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

let app: App | undefined;

function setup() {
  const [api, mounted] = withSetup(() => usePdfExport());
  app = mounted;
  return api;
}

async function generate(
  pet: Pet,
  readings: Reading[],
  months: string[],
  newestFirst?: boolean,
  includeNotes?: boolean,
) {
  await setup().generatePdf(pet, readings, months, newestFirst, includeNotes);
  return h.docs.at(-1)!;
}

const texts = (events: DocEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.value].flat() : []));

const readings = [
  makeReading({ id: 'jan', date: '2024-01-10T12:00:00.000Z', rate: 20 }),
  makeReading({ id: 'feb-1', date: '2024-02-05T08:00:00.000Z', rate: 22 }),
  makeReading({ id: 'feb-2', date: '2024-02-05T18:00:00.000Z', rate: 28 }),
  makeReading({ id: 'feb-3', date: '2024-02-07T12:00:00.000Z', rate: 40 }),
  makeReading({ id: 'mar', date: '2024-03-15T12:00:00.000Z', rate: 24 }),
];

beforeEach(() => {
  h.locale = 'en';
  h.docs.length = 0;
  h.charts.length = 0;
  h.failSave = null;
  h.failPhoto = false;
  vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,CANVAS',
  );
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
});

describe('usePdfExport', () => {
  it('sets isGenerating while the PDF is built', async () => {
    const { isGenerating, generatePdf } = setup();
    expect(isGenerating.value).toBe(false);
    const done = generatePdf(makePet(), readings, ['2024-03']);
    expect(isGenerating.value).toBe(true);
    await done;
    expect(isGenerating.value).toBe(false);
  });

  it('resets isGenerating and rethrows when generation fails', async () => {
    h.failSave = new Error('disk full');
    const { isGenerating, generatePdf } = setup();
    await expect(generatePdf(makePet(), readings, ['2024-03'])).rejects.toThrow('disk full');
    expect(isGenerating.value).toBe(false);
  });

  it('hands the PDF to the share sheet in the app instead of downloading it', async () => {
    mockNative();
    const doc = await generate(makePet({ name: 'Mr. Biscuit' }), readings, ['2024-03']);
    expect(doc.saved).toEqual([]);
    expect(shareFile).toHaveBeenCalledWith({
      name: 'cardipaw-mr-biscuit-2024-06-01.pdf',
      data: 'JVBERi0=',
      encoding: 'base64',
      subject: 'CardiPaw report – Mr. Biscuit',
      dialogTitle: 'Share PDF report',
    });
  });

  it('reports whether the PDF was saved, shared or the share sheet was closed', async () => {
    const { generatePdf } = setup();
    await expect(generatePdf(makePet(), readings, ['2024-03'])).resolves.toBe('saved');
    mockNative();
    await expect(generatePdf(makePet(), readings, ['2024-03'])).resolves.toBe('shared');
    vi.mocked(shareFile).mockResolvedValueOnce('cancelled');
    await expect(generatePdf(makePet(), readings, ['2024-03'])).resolves.toBe('cancelled');
  });

  it('saves as cardipaw-<name>-<local date>.pdf', async () => {
    const doc = await generate(makePet({ name: 'Mr. Biscuit' }), readings, ['2024-03']);
    expect(doc.saved).toEqual(['cardipaw-mr-biscuit-2024-06-01.pdf']);
  });

  it.each([
    ['ポチ', 'cardipaw-ポチ-2024-06-01.pdf'],
    ['Zoë', 'cardipaw-zoë-2024-06-01.pdf'],
    ['  Max & Ruby!  ', 'cardipaw-max-ruby-2024-06-01.pdf'],
    ['Rex 2', 'cardipaw-rex-2-2024-06-01.pdf'],
    // Typed with a combining diaeresis; saved precomposed (NFC).
    ['Zoe\u0308', 'cardipaw-zo\u00eb-2024-06-01.pdf'],
    // Devanagari vowel signs are combining marks, not letters.
    ['मोती', 'cardipaw-मोती-2024-06-01.pdf'],
  ])('keeps letters from any script in the filename (%s)', async (name, file) => {
    const doc = await generate(makePet({ name }), readings, ['2024-03']);
    expect(doc.saved).toEqual([file]);
  });

  it('leaves the name out of the filename when it has no letters or digits', async () => {
    const doc = await generate(makePet({ name: '???' }), readings, ['2024-03']);
    expect(doc.saved).toEqual(['cardipaw-2024-06-01.pdf']);
  });

  it('shortens a long name in the filename to 50 characters', async () => {
    const doc = await generate(makePet({ name: 'a'.repeat(49) + ' bcd' }), readings, ['2024-03']);
    expect(doc.saved).toEqual([`cardipaw-${'a'.repeat(49)}-2024-06-01.pdf`]);
  });

  it('counts the 50 characters by code point, not by UTF-16 unit', async () => {
    const doc = await generate(makePet({ name: '𠀀'.repeat(60) }), readings, ['2024-03']);
    expect(doc.saved).toEqual([`cardipaw-${'𠀀'.repeat(50)}-2024-06-01.pdf`]);
  });

  it('dates the filename by the local day, not UTC', async () => {
    stubTimezone('America/Los_Angeles');
    vi.setSystemTime(new Date('2024-06-01T02:00:00.000Z'));
    const doc = await generate(makePet(), readings, ['2024-03']);
    expect(doc.saved).toEqual(['cardipaw-ace-2024-05-31.pdf']);
  });

  it('puts the pet name, species and age in the header', async () => {
    const doc = await generate(makePet({ birthdate: '2020-01-01' }), readings, ['2024-03']);
    const all = texts(doc.events);
    expect(all).toContain('Ace');
    expect(all).toContain('Dog · 4y 5mo');
    expect(all).toContain('CardiPaw Respiratory Rate Report');
    expect(all).toContain('June 1, 2024');
  });

  it('shows only the species for a pet without a birthdate', async () => {
    const doc = await generate(makePet({ birthdate: '' }), readings, ['2024-03']);
    expect(texts(doc.events)).toContain('Dog');
    expect(doc.saved).toHaveLength(1);
  });

  it('includes only the selected months, newest first by default', async () => {
    const doc = await generate(makePet(), readings, ['2024-01', '2024-03']);
    const all = texts(doc.events);
    expect(all).not.toContain('February 2024');
    expect(all.filter((s) => /^\w+ 2024$/.test(s))).toEqual(['March 2024', 'January 2024']);
  });

  it('orders months oldest first when newestFirst is false', async () => {
    const doc = await generate(makePet(), readings, ['2024-03', '2024-01'], false);
    const all = texts(doc.events);
    expect(all.filter((s) => /^\w+ 2024$/.test(s))).toEqual(['January 2024', 'March 2024']);
  });

  it('starts on the first page when the first selected month has no readings', async () => {
    const doc = await generate(makePet(), readings, ['2024-05', '2024-03']);
    expect(doc.events.filter((e) => e.type === 'addPage')).toHaveLength(0);
    expect(texts(doc.events).filter((s) => s.startsWith('Page '))).toEqual(['Page 1 of 1']);
  });

  it('starts each month on a new page and numbers every page', async () => {
    const doc = await generate(makePet(), readings, ['2024-01', '2024-02', '2024-03']);
    const monthPages = doc.events.flatMap((e) =>
      e.type === 'text' && typeof e.value === 'string' && /^\w+ 2024$/.test(e.value)
        ? [[e.value, e.page]]
        : [],
    );
    expect(monthPages).toEqual([
      ['March 2024', 1],
      ['February 2024', 2],
      ['January 2024', 3],
    ]);
    expect(doc.events.filter((e) => e.type === 'addPage')).toHaveLength(2);
    expect(texts(doc.events).filter((s) => s.startsWith('Page '))).toEqual([
      'Page 1 of 3',
      'Page 2 of 3',
      'Page 3 of 3',
    ]);
  });

  it('lists each reading with a monthly summary', async () => {
    const doc = await generate(
      makePet(),
      [
        ...readings,
        makeReading({
          id: 'm',
          date: '2024-02-08T12:00:00Z',
          source: 'manual',
          restState: 'sleeping',
        }),
      ],
      ['2024-02'],
    );
    const all = texts(doc.events);
    expect(all).toContain('4 readings · Avg: 29 · Min: 22 · Max: 40 breaths/min');
    expect(all).toContain('Feb 5, 2024, 8:00 AM');
    expect(all).toContain('Feb 7, 2024, 12:00 PM');
    expect(all).toContain('Sleeping');
    expect(all).toContain('Manual');
    expect(all).not.toContain('Jan 10, 2024, 12:00 PM');
  });

  it('renders one chart per month with daily averages and the normal ceiling', async () => {
    await generate(makePet({ normalCeiling: 26 }), readings, ['2024-02', '2024-03']);
    expect(h.charts).toHaveLength(2);
    const [feb, mar] = [h.charts[1], h.charts[0]];
    expect(feb.cfg.data.labels).toEqual(['Feb 5', 'Feb 7']);
    expect(feb.cfg.data.datasets[0].data).toEqual([25, 40]);
    expect(feb.cfg.data.datasets[1].data).toEqual([26, 26]);
    expect(mar.cfg.data.datasets[0].data).toEqual([24]);
    expect(h.charts.every((c) => c.destroyed)).toBe(true);
    const doc = h.docs[0];
    const charts = doc.events.filter(
      (e) => e.type === 'addImage' && e.data === 'data:image/png;base64,CANVAS',
    );
    expect(charts).toHaveLength(2);
  });

  it('falls back to the default normal ceiling', async () => {
    await generate(makePet(), readings, ['2024-03']);
    expect(h.charts[0].cfg.data.datasets[1].data).toEqual([30]);
  });

  it('skips the notes section unless includeNotes is set', async () => {
    const noted = [
      makeReading({ notes: '<p>Coughing <strong>a bit</strong></p><ul><li><p>vet</p></li></ul>' }),
    ];
    const without = await generate(makePet(), noted, ['2024-03']);
    expect(texts(without.events)).not.toContain('Reading Notes');

    const withNotes = await generate(makePet(), noted, ['2024-03'], true, true);
    const all = texts(withNotes.events);
    expect(all).toContain('Reading Notes');
    expect(all).toContain('Coughing a bit');
    expect(all).toContain('- vet');
    expect(all.some((s) => s.includes('<'))).toBe(false);
  });

  it('omits the notes section when no reading in the month has a note', async () => {
    const doc = await generate(
      makePet(),
      [makeReading({ notes: '<p></p>' }), makeReading({ id: 'r2' })],
      ['2024-03'],
      true,
      true,
    );
    expect(texts(doc.events)).not.toContain('Reading Notes');
  });

  it('continues a long table on a new page with a repeated header', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      makeReading({
        id: `r${i}`,
        date: `2024-03-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`,
      }),
    );
    const doc = await generate(makePet(), many, ['2024-03']);
    expect(doc.events.filter((e) => e.type === 'addPage').length).toBeGreaterThan(0);
    expect(texts(doc.events).filter((s) => s === 'Date / Time').length).toBe(2);
  });

  it('adds a PNG photo to the header and survives a broken one', async () => {
    const photo = 'data:image/png;base64,PHOTO';
    const doc = await generate(makePet({ photo }), readings, ['2024-03']);
    expect(doc.events).toContainEqual(
      expect.objectContaining({ type: 'addImage', data: photo, format: 'PNG' }),
    );

    h.failPhoto = true;
    const broken = await generate(makePet({ photo: 'data:image/jpeg;base64,X' }), readings, [
      '2024-03',
    ]);
    expect(texts(broken.events)).toContain('Ace');
    expect(broken.saved).toHaveLength(1);
  });

  it('embeds the Japanese font when the app locale is ja', async () => {
    h.locale = 'ja';
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);
    const doc = await generate(makePet(), readings, ['2024-03']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(doc.fonts).toEqual(['NotoSansJP-Regular.ttf', 'NotoSansJP-Bold.ttf']);
    const families = doc.events.flatMap((e) => (e.type === 'setFont' ? [e.family] : []));
    expect(new Set(families)).toEqual(new Set(['NotoSansJP']));
  });
});
