export type Species = 'cat' | 'dog';

export interface Pet {
  id: string;
  name: string;
  species: Species;
  photo: string | null;
  birthdate: string; // "YYYY-MM-DD"
  createdAt: string; // ISO timestamp
}

export interface Reading {
  id: string;
  petId: string;
  date: string; // ISO timestamp
  rate: number; // breaths per minute (clickCount × 2)
  clickCount: number; // raw clicks during 30s
}

export interface ExportPayload {
  version: 1;
  exportedAt: string;
  pets: Pet[];
  readings: Reading[];
}
