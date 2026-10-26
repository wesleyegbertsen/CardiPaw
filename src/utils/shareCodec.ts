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

// Limits for links from strangers. The encoder refuses anything past them, so the
// app never makes a link its own decoder rejects. 10 000 readings (about 13 years
// at two a day) with every field set encode to 98 000–107 000 characters and
// inflate to 700–800 KB; both caps leave about twice that or more.
const MAX_SHARE_PARAM_LENGTH = 200_000;
const MAX_INFLATED_BYTES = 2_000_000;
const MAX_SHARED_READINGS = 10_000;
// The viewer draws one section and chart per month, so a few readings spread over
// thousands of months would pass the other caps and still lock up the page.
const MAX_SHARED_MONTHS = 240;
// Guided rates (taps × 2) have no upper bound and older links hold decimals, so no integer or 300 cap.
const MAX_SHARED_RATE = 1000;
const MAX_PET_NAME_LENGTH = 100;

/** The selection would make a link longer or larger than decodeShare accepts. */
export class ShareTooLargeError extends Error {
  constructor() {
    super('The selection is too large to share as a link.');
    this.name = 'ShareTooLargeError';
  }
}

export function buildSharePayload(pet: Pet, readings: Reading[], months: string[]): SharePayload {
  const monthSet = new Set(months);
  const shared = readings
    // Backup import accepts any finite rate; leave out the ones a link cannot carry
    // so a single bad value does not make the whole link undecodable.
    .filter((r) => monthSet.has(localMonthKey(r.date)) && isShareRate(r.rate))
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
  if (
    payload.readings.length > MAX_SHARED_READINGS ||
    countMonths(payload.readings) > MAX_SHARED_MONTHS
  ) {
    throw new ShareTooLargeError();
  }
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await compress(json);
  const encoded = toBase64Url(compressed);
  if (encoded.length > MAX_SHARE_PARAM_LENGTH) throw new ShareTooLargeError();
  return encoded;
}

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
// expands at most about 1032×, so the length cap (150 KB of compressed data) bounds
// what a browser can inflate ahead of this loop to about 155 MB.
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

// Counts months the way the viewer groups readings into sections.
function countMonths(readings: { date: string }[]): number {
  return new Set(readings.map((r) => localMonthKey(fromShareDate(r.date)))).size;
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

function isShareRate(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_SHARED_RATE;
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
  const readingsValid = v.readings.every((r) => {
    if (typeof r !== 'object' || r === null) return false;
    const reading = r as Record<string, unknown>;
    if (
      typeof reading.date !== 'string' ||
      !SHARE_DATE_TIME.test(reading.date) ||
      Number.isNaN(Date.parse(fromShareDate(reading.date)))
    ) {
      return false;
    }
    if (!isShareRate(reading.rate)) return false;
    return (
      reading.restState === undefined ||
      reading.restState === 'resting' ||
      reading.restState === 'sleeping'
    ) && (
      reading.source === undefined ||
      reading.source === 'manual'
    );
  });
  return readingsValid && countMonths(v.readings as { date: string }[]) <= MAX_SHARED_MONTHS;
}
