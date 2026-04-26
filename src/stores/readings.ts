import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Reading } from '../types';
import * as db from '../services/db';
import { v4 as generateId } from 'uuid';

export const useReadingsStore = defineStore('readings', () => {
  const readingsByPet = ref<Record<string, Reading[]>>({});

  const getReadingsForPet = computed(() => (petId: string): Reading[] => {
    const list = readingsByPet.value[petId] ?? [];
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  });

  async function loadReadingsForPet(petId: string) {
    const list = await db.getReadingsForPet(petId);
    readingsByPet.value[petId] = list;
  }

  async function addReading(data: Omit<Reading, 'id'>) {
    const reading: Reading = { id: generateId(), ...data };
    await db.saveReading(reading);
    if (!readingsByPet.value[data.petId]) {
      readingsByPet.value[data.petId] = [];
    }
    readingsByPet.value[data.petId].unshift(reading);
    return reading;
  }

  function clearReadingsForPet(petId: string) {
    delete readingsByPet.value[petId];
  }

  async function removeReading(id: string, petId: string) {
    await db.deleteReading(id);
    if (readingsByPet.value[petId]) {
      readingsByPet.value[petId] = readingsByPet.value[petId].filter(r => r.id !== id);
    }
  }

  async function updateReading(reading: Reading) {
    await db.saveReading(reading);
    if (readingsByPet.value[reading.petId]) {
      const idx = readingsByPet.value[reading.petId].findIndex(r => r.id === reading.id);
      if (idx !== -1) readingsByPet.value[reading.petId][idx] = reading;
    }
  }

  return { readingsByPet, getReadingsForPet, loadReadingsForPet, addReading, clearReadingsForPet, removeReading, updateReading };
});
