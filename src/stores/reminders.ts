import { defineStore } from 'pinia';
import { ref, computed, toRaw } from 'vue';
import type { Reminder } from '../types';
import * as db from '../services/db';
import { v4 as generateId } from 'uuid';

export const useRemindersStore = defineStore('reminders', () => {
  const remindersByPet = ref<Record<string, Reminder[]>>({});

  const getRemindersForPet = computed(() => (petId: string): Reminder[] => {
    return [...(remindersByPet.value[petId] ?? [])].sort((a, b) => a.time.localeCompare(b.time));
  });

  async function loadRemindersForPet(petId: string) {
    const list = await db.getRemindersForPet(petId);
    remindersByPet.value[petId] = list;
  }

  async function addReminder(data: Omit<Reminder, 'id' | 'createdAt'>) {
    const reminder: Reminder = { id: generateId(), createdAt: new Date().toISOString(), ...data };
    await db.saveReminder(reminder);
    if (!remindersByPet.value[data.petId]) {
      remindersByPet.value[data.petId] = [];
    }
    remindersByPet.value[data.petId].push(reminder);
    return reminder;
  }

  async function updateReminder(reminder: Reminder) {
    await db.saveReminder(reminder);
    if (remindersByPet.value[reminder.petId]) {
      const idx = remindersByPet.value[reminder.petId].findIndex(r => r.id === reminder.id);
      if (idx !== -1) remindersByPet.value[reminder.petId][idx] = reminder;
    }
  }

  async function toggleReminder(id: string, petId: string) {
    const list = remindersByPet.value[petId];
    if (!list) return;
    const reminder = list.find(r => r.id === id);
    if (!reminder) return;
    // toRaw needed: spreading a reactive proxy copies nested refs (e.g. days[]) as proxies,
    // which IDB's structured clone algorithm cannot serialize.
    const updated: Reminder = { ...toRaw(reminder), enabled: !reminder.enabled };
    await db.saveReminder(updated);
    const idx = list.findIndex(r => r.id === id);
    if (idx !== -1) list[idx] = updated;
  }

  async function removeReminder(id: string, petId: string) {
    await db.deleteReminder(id);
    if (remindersByPet.value[petId]) {
      remindersByPet.value[petId] = remindersByPet.value[petId].filter(r => r.id !== id);
    }
  }

  function clearRemindersForPet(petId: string) {
    delete remindersByPet.value[petId];
  }

  return {
    remindersByPet,
    getRemindersForPet,
    loadRemindersForPet,
    addReminder,
    updateReminder,
    toggleReminder,
    removeReminder,
    clearRemindersForPet,
  };
});
