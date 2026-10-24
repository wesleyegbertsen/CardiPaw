import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Pet } from '../types';
import * as db from '../services/db';
import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';
import { v4 as generateId } from 'uuid';

export const usePetsStore = defineStore('pets', () => {
  const pets = ref<Pet[]>([]);
  const loading = ref(false);
  let _loadPromise: Promise<void> | null = null;
  // Bumped by $reset so a load that started before the reset cannot write stale data.
  let _generation = 0;

  const getPetById = computed(() => (id: string) => pets.value.find((p) => p.id === id));

  async function loadPets() {
    if (_loadPromise) return _loadPromise;
    const generation = _generation;
    _loadPromise = (async () => {
      loading.value = true;
      let stale = false;
      try {
        const list = await db.getAllPets();
        stale = generation !== _generation;
        if (!stale) pets.value = list;
      } catch (e) {
        stale = generation !== _generation;
        if (!stale) throw e;
      } finally {
        if (!stale) {
          loading.value = false;
          _loadPromise = null;
        }
      }
      // Reset while loading: the result may be stale, so wait for a fresh load
      // instead of resolving (or rejecting) callers with pre-reset data.
      if (stale) await loadPets();
    })();
    return _loadPromise;
  }

  async function addPet(data: Omit<Pet, 'id' | 'createdAt'>) {
    const pet: Pet = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      ...data,
    };
    await db.savePet(pet);
    pets.value.push(pet);
    return pet;
  }

  async function updatePet(id: string, data: Partial<Omit<Pet, 'id' | 'createdAt'>>) {
    const existing = pets.value.find((p) => p.id === id);
    if (!existing) return;
    const updated: Pet = { ...existing, ...data };
    await db.savePet(updated);
    const index = pets.value.findIndex((p) => p.id === id);
    if (index !== -1) pets.value[index] = updated;
  }

  async function removePet(id: string) {
    await db.deletePet(id);
    await Promise.all([db.deleteReadingsForPet(id), db.deleteNotesForPet(id)]);
    pets.value = pets.value.filter((p) => p.id !== id);
    const readingsStore = useReadingsStore();
    readingsStore.clearReadingsForPet(id);
    const notesStore = useNotesStore();
    notesStore.clearNotesForPet(id);
  }

  function $reset() {
    _generation++;
    pets.value = [];
    loading.value = false;
    _loadPromise = null;
  }

  return { pets, loading, getPetById, loadPets, addPet, updatePet, removePet, $reset };
});
