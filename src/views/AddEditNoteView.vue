<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useNotesStore } from '../stores/notes';
import { usePetsStore } from '../stores/pets';
import RichTextEditor from '../components/RichTextEditor.vue';

const route = useRoute();
const router = useRouter();
const notesStore = useNotesStore();
const petsStore = usePetsStore();

const petId = route.params.id as string;
const noteId = route.params.noteId as string | undefined;
const isEditMode = computed(() => !!noteId);

const pet = computed(() => petsStore.getPetById(petId));
const existingNote = computed(() =>
  noteId ? notesStore.getNotesForPet(petId).find(n => n.id === noteId) ?? null : null
);

const editTitle = ref('');
const editContent = ref('');
const editPinned = ref(false);
const saving = ref(false);

onMounted(async () => {
  await petsStore.loadPets();
  if (isEditMode.value) {
    await notesStore.loadNotesForPet(petId);
    if (!existingNote.value) {
      router.push({ name: 'pet', params: { id: petId }, query: { tab: 'notes' } });
      return;
    }
    editTitle.value = existingNote.value.title;
    editContent.value = existingNote.value.content;
    editPinned.value = !!existingNote.value.pinnedAt;
  }
});

function goBack() {
  if (isEditMode.value && noteId) {
    router.replace({ name: 'note', params: { id: petId, noteId } });
  } else {
    router.replace({ name: 'pet', params: { id: petId }, query: { tab: 'notes' } });
  }
}

async function save() {
  if (saving.value || !editTitle.value.trim()) return;
  saving.value = true;
  try {
    if (isEditMode.value && existingNote.value) {
      const wasPinned = !!existingNote.value.pinnedAt;
      await notesStore.updateNote({
        ...existingNote.value,
        title: editTitle.value.trim(),
        content: editContent.value,
        modifiedAt: new Date().toISOString(),
        pinnedAt: editPinned.value
          ? (wasPinned ? existingNote.value.pinnedAt : new Date().toISOString())
          : undefined,
      });
      router.replace({ name: 'note', params: { id: petId, noteId } });
    } else {
      await notesStore.addNote({
        petId,
        title: editTitle.value.trim(),
        content: editContent.value,
        createdAt: new Date().toISOString(),
        pinnedAt: editPinned.value ? new Date().toISOString() : undefined,
      });
      router.replace({ name: 'pet', params: { id: petId }, query: { tab: 'notes' } });
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="note-edit-view">
    <header class="note-header">
      <div class="header-start">
        <button class="back-btn" @click="goBack" aria-label="Go back">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
      </div>

      <div class="header-center">
        <span class="header-title">{{ isEditMode ? 'Edit note' : 'New note' }}</span>
        <span class="header-subtitle">{{ pet?.name }}</span>
      </div>

      <div class="header-actions">
        <button
          type="button"
          class="icon-btn"
          :class="{ pinned: editPinned }"
          @click="editPinned = !editPinned"
          :aria-label="editPinned ? 'Unpin note' : 'Pin note'"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
          </svg>
        </button>
      </div>
    </header>

    <form class="form" @submit.prevent="save">
      <div class="field">
        <label class="label" for="note-title">Title</label>
        <input
          id="note-title"
          class="title-input"
          type="text"
          v-model="editTitle"
          placeholder="Note title"
          required
          autocomplete="off"
        />
      </div>

      <div class="field">
        <label class="label">Content</label>
        <RichTextEditor v-model="editContent" />
      </div>

      <button type="submit" class="submit-btn" :disabled="saving || !editTitle.trim()">
        {{ saving ? 'Saving…' : isEditMode ? 'Save changes' : 'Add note' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.note-edit-view {
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
}

.header-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1;
  white-space: nowrap;
}

.header-actions {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.form {
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.title-input {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 16px;
  font-weight: 500;
  box-sizing: border-box;
}

.title-input::placeholder {
  color: var(--color-text-muted);
  font-weight: 400;
}

.title-input:focus {
  outline: none;
  border-color: var(--color-primary);
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

.submit-btn {
  height: 52px;
  background: var(--color-primary);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  border-radius: var(--radius-md);
  transition: opacity 0.15s;
}

.submit-btn:disabled {
  opacity: 0.5;
}
</style>
