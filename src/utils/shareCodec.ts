import type { Pet, Reading, SharePayload, SharedReadingTuple } from '../types';

// Encodes a SharePayload into a compact URL-safe string (and back) so a pet's
// readings can be shared as a link. The data is deflate-compressed and
// base64url-encoded into the URL fragment — it never reaches any server.

export class ShareDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareDecodeError';
  }
}

const REST_STATE_TO_CODE = { resting: 1, sleeping: 2 } as const;

export const CODE_TO_REST_STATE: Record<number, 'resting' | 'sleeping' | undefined> = {
  1: 'resting',
  2: 'sleeping',
};

export function buildSharePayload(pet: Pet, readings: Reading[], months: string[]): SharePayload {
  const monthSet = new Set(months);
  const shared = readings
    .filter((r) => monthSet.has(r.date.slice(0, 7)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r): SharedReadingTuple => {
      const date = r.date.slice(0, 16); // minute precision keeps the URL short
      return r.restState ? [date, r.rate, REST_STATE_TO_CODE[r.restState]] : [date, r.rate];
    });

  return {
    v: 1,
    sharedAt: new Date().toISOString().slice(0, 10),
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
  const compressed = await transform(json, new CompressionStream('deflate-raw'));
  return toBase64Url(compressed);
}

export async function decodeShare(encoded: string): Promise<SharePayload> {
  let payload: unknown;
  try {
    const compressed = fromBase64Url(encoded);
    const json = await transform(compressed, new DecompressionStream('deflate-raw'));
    payload = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new ShareDecodeError('The link could not be decoded.');
  }
  if (!isSharePayload(payload)) {
    throw new ShareDecodeError('The link does not contain a valid snapshot.');
  }
  return payload;
}

async function transform(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  const piped = new Blob([bytes]).stream().pipeThrough(stream);
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

function isSharePayload(value: unknown): value is SharePayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.sharedAt !== 'string') return false;
  const pet = v.pet as Record<string, unknown> | undefined;
  if (!pet || typeof pet !== 'object') return false;
  if (typeof pet.name !== 'string' || typeof pet.birthdate !== 'string') return false;
  if (pet.species !== 'cat' && pet.species !== 'dog') return false;
  if (!Array.isArray(v.readings)) return false;
  return v.readings.every(
    (r) => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'number'
  );
}
