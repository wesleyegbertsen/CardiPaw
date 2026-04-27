import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Pet, Species } from '../types';
import * as db from '../services/db';
import { useReadingsStore } from './readings';
import { useNotesStore } from './notes';
import { v4 as generateId } from 'uuid';

export const usePetsStore = defineStore('pets', () => {
  const pets = ref<Pet[]>([]);
  const loading = ref(false);
  let _loadPromise: Promise<void> | null = null;

  const getPetById = computed(() => (id: string) => pets.value.find((p) => p.id === id));

  async function loadPets() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
      loading.value = true;
      try {
        pets.value = await db.getAllPets();
      } finally {
        loading.value = false;
        _loadPromise = null;
      }
    })();
    return _loadPromise;
  }

  async function addPet(data: { name: string; species: Species; photo: string | null; birthdate: string }) {
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

  return { pets, loading, getPetById, loadPets, addPet, updatePet, removePet };
});
