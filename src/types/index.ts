export type Species = 'cat' | 'dog';

export interface Pet {
  id: string;
  name: string;
  species: Species;
  photo: string | null;
  birthdate: string; // "YYYY-MM-DD"
  createdAt: string; // ISO timestamp
  normalCeiling?: number;   // breaths/min; absent = use default 30
  elevatedCeiling?: number; // breaths/min; absent = use default 35
}

/** Length of a guided measurement, in seconds. */
export type MeasurementSeconds = 15 | 30 | 60;

export interface Reading {
  id: string;
  petId: string;
  date: string; // ISO timestamp
  rate: number; // breaths per minute; set when saved (clickCount scaled to a minute) or edited, never recomputed
  clickCount: number; // raw taps during the guided measurement; 0 for manual entries
  durationSeconds?: MeasurementSeconds; // guided only; absent = 30 (saved before the length could be chosen)
  restState?: 'resting' | 'sleeping';
  notes?: string;
  source?: 'manual'; // absent = guided measurement
}

export interface Note {
  id: string;
  petId: string;
  title: string;
  content: string; // rich HTML from TipTap
  createdAt: string; // ISO timestamp — set once on creation
  modifiedAt?: string; // ISO timestamp — only set when title/content is edited
  pinnedAt?: string; // ISO timestamp when pinned; absent = not pinned
}

export interface ExportPayload {
  version: 1;
  exportedAt: string;
  pets: Pet[];
  readings: Reading[];
  notes: Note[];
}

export interface SharePayload {
  v: 1;
  sharedAt: string; // "YYYY-MM-DD"
  pet: Pick<Pet, 'name' | 'species' | 'birthdate' | 'normalCeiling' | 'elevatedCeiling'>;
  // date is truncated to minute precision in UTC ("YYYY-MM-DDTHH:mmZ") to keep the URL short.
  // Older links omit the "Z"; decodeShare treats those as UTC too.
  readings: Pick<Reading, 'date' | 'rate' | 'restState' | 'source'>[];
}
