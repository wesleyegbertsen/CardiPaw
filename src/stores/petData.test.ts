import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../services/db';
import { forgetPetData, resetPetData } from './petData';
import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';
import { makeNote, makeReading } from '../test/fixtures';

const pet2Reading = makeReading({ id: 'r2', petId: 'pet-2' });
const pet2Note = makeNote({ id: 'n2', petId: 'pet-2' });

// Loads both pets' readings and notes into fresh stores.
beforeEach(async () => {
  await db.importAllData({
    version: 1,
    exportedAt: '',
    pets: [],
    readings: [makeReading(), pet2Reading],
    notes: [makeNote(), pet2Note],
  });
  setActivePinia(createPinia());
  for (const petId of ['pet-1', 'pet-2']) {
    await useReadingsStore().loadReadingsForPet(petId);
    await useNotesStore().loadNotesForPet(petId);
  }
});

describe('petData', () => {
  it('forgets only the given pet’s readings and notes', () => {
    forgetPetData('pet-1');

    expect(useReadingsStore().readingsByPet).toEqual({ 'pet-2': [pet2Reading] });
    expect(useNotesStore().notesByPet).toEqual({ 'pet-2': [pet2Note] });
  });

  it('resets every per-pet cache', () => {
    resetPetData();

    expect(useReadingsStore().readingsByPet).toEqual({});
    expect(useNotesStore().notesByPet).toEqual({});
  });
});
