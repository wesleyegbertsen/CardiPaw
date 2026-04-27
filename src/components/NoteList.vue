<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Note } from '../types';

const props = defineProps<{ notes: Note[]; petId: string }>();

const router = useRouter();

const PAGE = 20;
const visibleCount = ref(PAGE);
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const visibleNotes = computed(() => props.notes.slice(0, visibleCount.value));
const hasMore = computed(() => visibleCount.value < props.notes.length);

const hasPinned = computed(() => props.notes.some(n => n.pinnedAt));
const firstUnpinnedIndex = computed(() => props.notes.findIndex(n => !n.pinnedAt));

watch(() => props.notes.length, () => { visibleCount.value = PAGE; });

watch(hasMore, (val) => {
  if (!val) observer?.disconnect();
});

onMounted(() => {
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) visibleCount.value += PAGE;
  });
  if (sentinel.value) observer.observe(sentinel.value);
});

onUnmounted(() => observer?.disconnect());

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function openNote(note: Note) {
  router.push({ name: 'note', params: { id: props.petId, noteId: note.id } });
}
</script>

<template>
  <div class="note-list">
    <div v-if="notes.length === 0" class="empty">
      No notes yet. Tap '+' to write your first one.
    </div>

    <template v-for="(note, index) in visibleNotes" :key="note.id">
      <div v-if="hasPinned && index === 0" class="section-header">Pinned</div>
      <div v-if="hasPinned && index === firstUnpinnedIndex" class="section-header">Notes</div>
    <div
      class="note-item"
      @click="openNote(note)"
    >
      <div class="note-left">
        <div class="note-title">{{ note.title }}</div>
        <div class="note-meta">
          <span class="note-date">{{ formatDate(note.modifiedAt ?? note.createdAt) }}</span>
          <span v-if="note.modifiedAt" class="edited-label">Edited</span>
        </div>
      </div>
      <div class="note-right">
        <span v-if="note.pinnedAt" class="pin-badge" aria-label="Pinned">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
          </svg>
        </span>
        <svg class="chevron" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M9.29 6.71a1 1 0 0 0 0 1.41L13.17 12l-3.88 3.88a1 1 0 1 0 1.41 1.41l4.59-4.59a1 1 0 0 0 0-1.41L10.7 6.7a1 1 0 0 0-1.41.01z"/>
        </svg>
      </div>
    </div>
    </template>

    <div v-if="hasMore" ref="sentinel" class="sentinel" />
  </div>
</template>

<style scoped>
.note-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty {
  padding: 24px 0;
  text-align: center;
  font-size: 14px;
  color: var(--color-text-muted);
}

.section-header {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-muted);
  padding: 4px 4px 0;
}

.note-item {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0 12px;
  padding: 14px 16px;
  min-height: 70px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: background 0.12s, box-shadow 0.15s, transform 0.1s;
}

.note-item:hover {
  box-shadow: var(--shadow-md);
}

.note-item:active {
  transform: scale(0.98);
}

.note-left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-width: 0;
}

.note-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.note-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.note-date {
  font-size: 13px;
  color: var(--color-text-muted);
}

.edited-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-bg);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

.note-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.pin-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.chevron {
  flex-shrink: 0;
  color: var(--color-border);
}

.note-item:hover .chevron {
  color: var(--color-text-muted);
}

.sentinel {
  height: 1px;
}
</style>
