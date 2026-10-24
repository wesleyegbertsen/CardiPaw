import { describe, expect, it } from 'vitest';
import { buildSharePayload, decodeShare, encodeShare, ShareDecodeError } from './shareCodec';
import type { Pet, Reading, SharePayload } from '../types';

const pet: Pet = {
  id: 'pet-1',
  name: 'Mochi',
  species: 'cat',
  photo: 'data:image/png;base64,AAAA',
  birthdate: '2019-05-12',
  createdAt: '2024-01-01T10:00:00.000Z',
};

// Mid-month, mid-day timestamps so the month filter gives the same result in every timezone.
function reading(id: string, date: string, rate: number, extra: Partial<Reading> = {}): Reading {
  return { id, petId: pet.id, date, rate, clickCount: rate / 2, ...extra };
}

const samplePayload: SharePayload = {
  v: 1,
  sharedAt: '2026-03-20',
  pet: { name: 'Mochi', species: 'cat', birthdate: '2019-05-12', normalCeiling: 28 },
  readings: [
    { date: '2026-03-14T08:30Z', rate: 22 },
    { date: '2026-03-15T21:10Z', rate: 26, restState: 'sleeping' },
    { date: '2026-03-16T12:00Z', rate: 40, restState: 'resting', source: 'manual' },
  ],
};

// Raw deflate + base64url, the same transport encodeShare uses, for hand-crafted payloads.
async function encodeRaw(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('buildSharePayload', () => {
  const readings = [
    reading('r3', '2026-03-20T12:00:00.000Z', 30, { restState: 'sleeping' }),
    reading('r1', '2026-02-10T12:00:00.000Z', 20),
    reading('r2', '2026-03-05T12:00:00.000Z', 24, { source: 'manual', notes: 'private' }),
    reading('r4', '2026-04-15T12:00:00.000Z', 50),
  ];

  it('keeps only readings from the selected months, oldest first', () => {
    const payload = buildSharePayload(pet, readings, ['2026-03']);
    expect(payload.readings.map((r) => r.rate)).toEqual([24, 30]);

    const twoMonths = buildSharePayload(pet, readings, ['2026-02', '2026-04']);
    expect(twoMonths.readings.map((r) => r.rate)).toEqual([20, 50]);
  });

  it('returns no readings when no months are selected', () => {
    expect(buildSharePayload(pet, readings, []).readings).toEqual([]);
  });

  it('only shares the fields the viewer needs', () => {
    const payload = buildSharePayload(pet, readings, ['2026-03']);
    expect(payload.v).toBe(1);
    expect(payload.sharedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.pet).toEqual({ name: 'Mochi', species: 'cat', birthdate: '2019-05-12' });
    for (const r of payload.readings) {
      expect(typeof r.date).toBe('string');
      expect(r).not.toHaveProperty('id');
      expect(r).not.toHaveProperty('petId');
      expect(r).not.toHaveProperty('clickCount');
      expect(r).not.toHaveProperty('notes');
    }
    expect(payload.readings[0]).toMatchObject({ rate: 24, source: 'manual' });
    expect(payload.readings[0]).not.toHaveProperty('restState');
    expect(payload.readings[1]).toMatchObject({ rate: 30, restState: 'sleeping' });
    expect(payload.readings[1]).not.toHaveProperty('source');
  });

  it('includes custom ceilings only when the pet has them, including 0', () => {
    const custom = buildSharePayload({ ...pet, normalCeiling: 0, elevatedCeiling: 40 }, readings, [
      '2026-03',
    ]);
    expect(custom.pet).toMatchObject({ normalCeiling: 0, elevatedCeiling: 40 });

    const defaults = buildSharePayload(pet, readings, ['2026-03']);
    expect(defaults.pet).not.toHaveProperty('normalCeiling');
    expect(defaults.pet).not.toHaveProperty('elevatedCeiling');
  });

  it('does not reorder the caller’s readings array', () => {
    const copy = [...readings];
    buildSharePayload(pet, readings, ['2026-03']);
    expect(readings).toEqual(copy);
  });
});

describe('encodeShare / decodeShare', () => {
  it('round-trips a payload unchanged', async () => {
    const encoded = await encodeShare(samplePayload);
    await expect(decodeShare(encoded)).resolves.toEqual(samplePayload);
  });

  it('produces URL-safe output without padding', async () => {
    const encoded = await encodeShare(samplePayload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips non-ASCII pet names', async () => {
    const payload: SharePayload = {
      ...samplePayload,
      pet: { ...samplePayload.pet, name: 'もち Ünïcødé 🐾' },
    };
    await expect(decodeShare(await encodeShare(payload))).resolves.toEqual(payload);
  });

  it('round-trips a payload with no readings', async () => {
    const payload: SharePayload = { ...samplePayload, readings: [] };
    await expect(decodeShare(await encodeShare(payload))).resolves.toEqual(payload);
  });

  it('round-trips the output of buildSharePayload', async () => {
    const built = buildSharePayload(
      { ...pet, elevatedCeiling: 38 },
      [reading('a', '2026-03-10T12:00:00.000Z', 26), reading('b', '2026-03-11T12:00:00.000Z', 32)],
      ['2026-03'],
    );
    await expect(decodeShare(await encodeShare(built))).resolves.toEqual(built);
  });

  it.each([
    ['an empty string', ''],
    ['characters outside base64', 'not a share link!!'],
    ['base64 that is not deflate data', 'aGVsbG8gd29ybGQ'],
  ])('rejects %s with ShareDecodeError', async (_name, input) => {
    await expect(decodeShare(input)).rejects.toBeInstanceOf(ShareDecodeError);
  });

  it('rejects a truncated link', async () => {
    const encoded = await encodeShare(samplePayload);
    const truncated = encoded.slice(0, Math.floor(encoded.length / 2));
    await expect(decodeShare(truncated)).rejects.toBeInstanceOf(ShareDecodeError);
  });

  it('rejects compressed data that is not JSON', async () => {
    await expect(decodeShare(await encodeRaw('definitely not json'))).rejects.toBeInstanceOf(
      ShareDecodeError,
    );
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', []],
    ['an unknown version', { ...samplePayload, v: 2 }],
    ['a missing sharedAt', { ...samplePayload, sharedAt: undefined }],
    ['a missing pet', { ...samplePayload, pet: undefined }],
    ['a non-string pet name', { ...samplePayload, pet: { ...samplePayload.pet, name: 42 } }],
    ['an unknown species', { ...samplePayload, pet: { ...samplePayload.pet, species: 'bird' } }],
    ['a missing birthdate', { ...samplePayload, pet: { ...samplePayload.pet, birthdate: null } }],
    ['readings that are not an array', { ...samplePayload, readings: {} }],
    ['a null reading', { ...samplePayload, readings: [null] }],
    [
      'a reading with a string rate',
      { ...samplePayload, readings: [{ date: '2026-03-14T08:30Z', rate: '22' }] },
    ],
    ['a reading without a date', { ...samplePayload, readings: [{ rate: 22 }] }],
    [
      'a reading with an unknown restState',
      {
        ...samplePayload,
        readings: [{ date: '2026-03-14T08:30Z', rate: 22, restState: 'running' }],
      },
    ],
    [
      'a reading with an unknown source',
      { ...samplePayload, readings: [{ date: '2026-03-14T08:30Z', rate: 22, source: 'import' }] },
    ],
  ])('rejects a snapshot with %s', async (_name, value) => {
    const encoded = await encodeRaw(JSON.stringify(value));
    await expect(decodeShare(encoded)).rejects.toBeInstanceOf(ShareDecodeError);
  });

  it('gives decode failures a stable error name', async () => {
    await expect(decodeShare('!!!')).rejects.toMatchObject({ name: 'ShareDecodeError' });
  });
});
