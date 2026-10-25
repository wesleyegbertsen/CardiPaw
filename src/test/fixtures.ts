import type { Note, Pet, Reading } from '../types';

// Valid records as the app itself writes them; override only what a test cares about.

export const makePet = (overrides: Partial<Pet> = {}): Pet => ({
  id: 'pet-1',
  name: 'Ace',
  species: 'dog',
  photo: null,
  birthdate: '2020-01-01',
  createdAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

export const makeReading = (overrides: Partial<Reading> = {}): Reading => ({
  id: 'reading-1',
  petId: 'pet-1',
  date: '2024-03-15T12:00:00.000Z',
  rate: 24,
  clickCount: 12,
  ...overrides,
});

export const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-1',
  petId: 'pet-1',
  title: 'Vet visit',
  content: '<p>All good</p>',
  createdAt: '2024-03-15T12:00:00.000Z',
  ...overrides,
});
