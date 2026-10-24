import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Note } from '../types';
import * as db from '../services/db';
import { v4 as generateId } from 'uuid';

export const useNotesStore = defineStore('notes', () => {
  const notesByPet = ref<Record<string, Note[]>>({});

  const getNotesForPet = computed(() => (petId: string): Note[] => {
    const list = notesByPet.value[petId] ?? [];
    return [...list].sort((a, b) => {
      const aPinned = !!a.pinnedAt;
      const bPinned = !!b.pinnedAt;
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return (b.modifiedAt ?? b.createdAt).localeCompare(a.modifiedAt ?? a.createdAt);
    });
  });

  // Bumped by $reset so a load that started before the reset cannot write stale data.
  let generation = 0;

  async function loadNotesForPet(petId: string): Promise<void> {
    const startedAt = generation;
    const list = await db.getNotesForPet(petId);
    // Reset while loading: the list may be stale, so load again.
    if (startedAt !== generation) return loadNotesForPet(petId);
    notesByPet.value[petId] = list;
  }

  async function addNote(data: Omit<Note, 'id'>) {
    const note: Note = { id: generateId(), ...data };
    await db.saveNote(note);
    if (!notesByPet.value[data.petId]) {
      notesByPet.value[data.petId] = [];
    }
    notesByPet.value[data.petId].unshift(note);
    return note;
  }

  async function updateNote(note: Note) {
    await db.saveNote(note);
    if (notesByPet.value[note.petId]) {
      const idx = notesByPet.value[note.petId].findIndex(n => n.id === note.id);
      if (idx !== -1) notesByPet.value[note.petId][idx] = note;
    }
  }

  async function removeNote(id: string, petId: string) {
    await db.deleteNote(id);
    if (notesByPet.value[petId]) {
      notesByPet.value[petId] = notesByPet.value[petId].filter(n => n.id !== id);
    }
  }

  function clearNotesForPet(petId: string) {
    delete notesByPet.value[petId];
  }

  function $reset() {
    generation++;
    notesByPet.value = {};
  }

  return { notesByPet, getNotesForPet, loadNotesForPet, addNote, updateNote, removeNote, clearNotesForPet, $reset };
});
