<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useNotesStore } from '../stores/notes';
import { usePetsStore } from '../stores/pets';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const route = useRoute();
const router = useRouter();
const notesStore = useNotesStore();
const petsStore = usePetsStore();

const petId = route.params.id as string;
const noteId = route.params.noteId as string;

const pet = computed(() => petsStore.getPetById(petId));
const note = computed(() =>
  notesStore.getNotesForPet(petId).find(n => n.id === noteId) ?? null
);

const showDeleteDialog = ref(false);

onMounted(async () => {
  await petsStore.loadPets();
  await notesStore.loadNotesForPet(petId);
});

function goBack() {
  router.push({ name: 'pet', params: { id: petId }, query: { tab: 'notes' } });
}

async function togglePin() {
  if (!note.value) return;
  await notesStore.updateNote({
    ...note.value,
    pinnedAt: note.value.pinnedAt ? undefined : new Date().toISOString(),
    modifiedAt: note.value.modifiedAt,
  });
}

async function confirmDelete() {
  if (!note.value) return;
  await notesStore.removeNote(note.value.id, petId);
  router.push({ name: 'pet', params: { id: petId }, query: { tab: 'notes' } });
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

const sanitizedContent = computed(() => {
  const raw = note.value?.content ?? '';
  const isHtml = /^<[a-z]/i.test(raw.trimStart());
  return isHtml ? raw : raw.replace(/\n/g, '<br>');
});
</script>

<template>
  <div class="note-view">
    <header class="note-header">
      <div class="header-start">
        <button class="back-btn" @click="goBack" aria-label="Go back">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
      </div>

      <div class="header-center">
        <span class="header-title">{{ pet?.name }}</span>
      </div>

      <div class="header-actions">
        <button
          class="icon-btn"
          :class="{ pinned: note?.pinnedAt }"
          @click="togglePin"
          :aria-label="note?.pinnedAt ? 'Unpin note' : 'Pin note'"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
          </svg>
        </button>
        <button
          class="icon-btn"
          @click="router.replace({ name: 'note-edit', params: { id: petId, noteId } })"
          aria-label="Edit note"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
        </button>
        <button
          class="icon-btn danger"
          @click="showDeleteDialog = true"
          aria-label="Delete note"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    </header>

    <div v-if="note" class="note-body">
      <div class="note-card">
        <h1 class="note-title">{{ note.title }}</h1>
        <div class="note-dates">
          <span class="date-tag">
            <span class="date-tag-label">Created</span>
            {{ formatDate(note.createdAt) }}
          </span>
          <span v-if="note.modifiedAt" class="date-tag edited">
            <span class="date-tag-label">Edited</span>
            {{ formatDate(note.modifiedAt) }}
          </span>
          <span v-if="note.pinnedAt" class="date-tag pinned">
            <span class="date-tag-label">
              <svg viewBox="0 0 24 24" fill="currentColor" width="9" height="9" style="vertical-align: middle; margin-right: 2px;">
                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
              </svg>Pinned
            </span>
            {{ formatDate(note.pinnedAt) }}
          </span>
        </div>
      </div>

      <div class="detail-card">
        <div v-if="note.content" class="note-content" v-html="sanitizedContent" />
        <p v-else class="no-value">No content</p>
      </div>
    </div>

    <div v-else class="not-found">Note not found.</div>

    <ConfirmDialog
      v-if="showDeleteDialog"
      message="Delete this note? This cannot be undone."
      @confirm="confirmDelete"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>

<style scoped>
.note-view {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.note-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.header-start {
  flex: 1;
  display: flex;
}

.back-btn {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
}

.header-center {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
}

.header-actions {
  flex: 1;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.icon-btn.pinned {
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.icon-btn.danger {
  color: var(--color-danger);
}

.note-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.note-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.2;
}

.note-dates {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.date-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border-radius: var(--radius-full);
  padding: 3px 10px 3px 6px;
}

.date-tag-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--color-text-muted);
  background: var(--color-border);
  border-radius: var(--radius-full);
  padding: 2px 0;
  width: 62px;
  flex-shrink: 0;
}


.date-tag.pinned .date-tag-label {
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.detail-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: 16px 20px;
}

.note-content {
  font-size: 15px;
  color: var(--color-text);
  line-height: 1.6;
}

.note-content :deep(p) {
  margin-bottom: 0.4em;
}

.note-content :deep(p:last-child) {
  margin-bottom: 0;
}

.note-content :deep(ul) {
  padding-left: 20px;
}

.note-content :deep(li) {
  margin-bottom: 2px;
}

.note-content :deep(strong) {
  font-weight: 600;
}

.note-content :deep(em) {
  font-style: italic;
}

.no-value {
  font-size: 14px;
  color: var(--color-text-muted);
}

.not-found {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-text-muted);
}
</style>
