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

export interface Reading {
  id: string;
  petId: string;
  date: string; // ISO timestamp
  rate: number; // breaths per minute (clickCount × 2)
  clickCount: number; // raw clicks during 30s
  restState?: 'resting' | 'sleeping';
  notes?: string;
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
