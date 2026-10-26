import type { Pet, Reading, SharePayload } from '../types';
import { localDayKey, localMonthKey } from './date';

// Encodes a SharePayload into a compact URL-safe string (and back) so a pet's
// readings can be shared as a link. The data is deflate-compressed and
// base64url-encoded into the URL fragment — it never reaches any server.

export class ShareDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareDecodeError';
  }
}

export function buildSharePayload(pet: Pet, readings: Reading[], months: string[]): SharePayload {
  const monthSet = new Set(months);
  const shared = readings
    .filter((r) => monthSet.has(localMonthKey(r.date)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: toShareDate(r.date),
      rate: r.rate,
      ...(r.restState && { restState: r.restState }),
      ...(r.source && { source: r.source }),
    }));

  return {
    v: 1,
    sharedAt: localDayKey(new Date()),
    pet: {
      name: pet.name,
      species: pet.species,
      birthdate: pet.birthdate,
      ...(pet.normalCeiling !== undefined && { normalCeiling: pet.normalCeiling }),
      ...(pet.elevatedCeiling !== undefined && { elevatedCeiling: pet.elevatedCeiling }),
    },
    readings: shared,
  };
}

export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await compress(json);
  return toBase64Url(compressed);
}

// Limits for links from strangers. Each sits well above anything the app
// produces: 10 000 readings (about 13 years at two a day) encode to about
// 86 000 characters and inflate to about 550 KB.
const MAX_SHARE_PARAM_LENGTH = 100_000;
const MAX_INFLATED_BYTES = 2_000_000;
const MAX_SHARED_READINGS = 10_000;
// Guided rates (taps × 2) have no upper bound and older links hold decimals, so no integer or 300 cap.
const MAX_SHARED_RATE = 1000;
const MAX_PET_NAME_LENGTH = 100;

export async function decodeShare(encoded: string): Promise<SharePayload> {
  if (encoded.length > MAX_SHARE_PARAM_LENGTH) {
    throw new ShareDecodeError('The link is too long.');
  }
  let payload: unknown;
  try {
    const compressed = fromBase64Url(encoded);
    const json = await inflate(compressed, MAX_INFLATED_BYTES);
    payload = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new ShareDecodeError('The link could not be decoded.');
  }
  if (!isSharePayload(payload)) {
    throw new ShareDecodeError('The link does not contain a valid snapshot.');
  }
  return {
    ...payload,
    pet: {
      ...payload.pet,
      name: Array.from(payload.pet.name).slice(0, MAX_PET_NAME_LENGTH).join(''),
      // Older versions accepted malformed birthdates; show "unknown age" rather than refuse the link.
      birthdate: isShareDay(payload.pet.birthdate) ? payload.pet.birthdate : '',
    },
    readings: payload.readings.map((r) => ({ ...r, date: fromShareDate(r.date) })),
  };
}

// Stops reading once the output passes `limit`, so a short link that inflates to
// tens of megabytes (a deflate bomb) is never joined, decoded or parsed. Deflate
// expands at most about 1000×, so the length cap bounds what a browser can inflate
// ahead of this loop.
async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new Error('Inflated share data exceeds the limit');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// Stored dates are UTC toISOString() values. Minute precision keeps the URL
// short; the trailing "Z" keeps the instant unambiguous so viewers in any
// timezone see the same moment.
function toShareDate(iso: string): string {
  return iso.slice(0, 16) + 'Z';
}

// Links created before dates carried an offset hold UTC times without one
// ("YYYY-MM-DDTHH:mm"), which JS would parse as local time. Mark them as UTC.
const OFFSETLESS_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

function fromShareDate(date: string): string {
  return OFFSETLESS_DATE_TIME.test(date) ? date + 'Z' : date;
}

async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  const piped = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const SHARE_DAY = /^\d{4}-\d{2}-\d{2}$/;
// Every app version wrote reading times as YYYY-MM-DDTHH:MM…; Date.parse alone also accepts "1" or "March 5".
const SHARE_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function isShareDay(s: unknown): s is string {
  return typeof s === 'string' && SHARE_DAY.test(s) && !Number.isNaN(Date.parse(s));
}

function isOptionalFinite(n: unknown): boolean {
  return n === undefined || (typeof n === 'number' && Number.isFinite(n));
}

function isSharePayload(value: unknown): value is SharePayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !isShareDay(v.sharedAt)) return false;
  const pet = v.pet as Record<string, unknown> | undefined;
  if (!pet || typeof pet !== 'object') return false;
  if (typeof pet.name !== 'string' || typeof pet.birthdate !== 'string') return false;
  if (pet.species !== 'cat' && pet.species !== 'dog') return false;
  if (!isOptionalFinite(pet.normalCeiling) || !isOptionalFinite(pet.elevatedCeiling)) return false;
  if (!Array.isArray(v.readings) || v.readings.length > MAX_SHARED_READINGS) return false;
  return v.readings.every((r) => {
    if (typeof r !== 'object' || r === null) return false;
    const reading = r as Record<string, unknown>;
    if (
      typeof reading.date !== 'string' ||
      !SHARE_DATE_TIME.test(reading.date) ||
      Number.isNaN(Date.parse(fromShareDate(reading.date)))
    ) {
      return false;
    }
    if (
      typeof reading.rate !== 'number' ||
      !Number.isFinite(reading.rate) ||
      reading.rate < 0 ||
      reading.rate > MAX_SHARED_RATE
    ) {
      return false;
    }
    return (
      reading.restState === undefined ||
      reading.restState === 'resting' ||
      reading.restState === 'sleeping'
    ) && (
      reading.source === undefined ||
      reading.source === 'manual'
    );
  });
}
