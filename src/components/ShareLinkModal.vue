<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Pet, Reading } from '../types';
import { buildSharePayload, encodeShare } from '../utils/shareCodec';

const props = defineProps<{ pet: Pet; readings: Reading[] }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();

const availableMonths = computed(() => {
  const set = new Set(props.readings.map(r => r.date.slice(0, 7)));
  return [...set].sort().reverse();
});

const selectedMonths = ref<string[]>([...availableMonths.value]);

const allSelected = computed(
  () => selectedMonths.value.length === availableMonths.value.length
);

function toggleAll() {
  selectedMonths.value = allSelected.value ? [] : [...availableMonths.value];
}

function toggleMonth(month: string) {
  const idx = selectedMonths.value.indexOf(month);
  if (idx >= 0) {
    selectedMonths.value = selectedMonths.value.filter(m => m !== month);
  } else {
    selectedMonths.value = [...selectedMonths.value, month];
  }
}

function formatMonth(key: string): string {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(
    new Date(key + '-15')
  );
}

function countReadings(monthKey: string): number {
  return props.readings.filter(r => r.date.startsWith(monthKey)).length;
}

const shareUrl = ref('');
let encodeToken = 0;

watch(
  selectedMonths,
  async (months) => {
    const token = ++encodeToken;
    if (months.length === 0) {
      shareUrl.value = '';
      return;
    }
    const payload = buildSharePayload(props.pet, props.readings, months);
    const encoded = await encodeShare(payload);
    if (token !== encodeToken) return; // a newer selection superseded this one
    const href = router.resolve({ name: 'share', query: { d: encoded } }).href;
    shareUrl.value = new URL(href, window.location.href).href;
  },
  { immediate: true }
);

// Some email/chat apps truncate very long URLs
const isLongUrl = computed(() => shareUrl.value.length > 8000);

const canNativeShare = typeof navigator.share === 'function';
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyLink() {
  if (!shareUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Clipboard unavailable (e.g. insecure context) — the link stays visible for manual copy
  }
}

async function nativeShare() {
  if (!shareUrl.value) return;
  try {
    await navigator.share({
      title: `${props.pet.name} — CardiPaw snapshot`,
      url: shareUrl.value,
    });
  } catch {
    // User dismissed the share sheet
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
        <div class="dialog-header">
          <h2 class="dialog-title" id="share-modal-title">Share</h2>
          <p class="dialog-subtitle">{{ pet.name }}</p>
        </div>

        <p class="privacy-note">
          The selected data is embedded in the link itself — nothing is uploaded
          to any server. Anyone you send the link to can view this data.
        </p>

        <div class="list-controls">
          <span class="list-info">
            {{ availableMonths.length }} month{{ availableMonths.length !== 1 ? 's' : '' }} available
          </span>
          <button class="toggle-all-btn" @click="toggleAll">
            {{ allSelected ? 'Clear all' : 'Select all' }}
          </button>
        </div>

        <div class="month-list">
          <label v-for="month in availableMonths" :key="month" class="month-row">
            <input
              type="checkbox"
              :checked="selectedMonths.includes(month)"
              @change="toggleMonth(month)"
            />
            <span class="month-label">{{ formatMonth(month) }}</span>
            <span class="month-badge">{{ countReadings(month) }}</span>
          </label>
        </div>

        <p v-if="selectedMonths.length === 0" class="empty-hint">
          Select at least one month to share.
        </p>

        <div v-else class="link-section">
          <input class="link-preview" :value="shareUrl" readonly @focus="($event.target as HTMLInputElement).select()" />
          <p v-if="isLongUrl" class="length-warning">
            This link is very long and may be truncated by some email or chat
            apps. Consider selecting fewer months.
          </p>
        </div>

        <div class="dialog-footer">
          <button class="btn-cancel" @click="emit('close')">Close</button>
          <button v-if="canNativeShare" class="btn-secondary" @click="nativeShare" :disabled="!shareUrl">
            Share…
          </button>
          <button class="btn-primary" @click="copyLink" :disabled="!shareUrl">
            {{ copied ? 'Copied!' : 'Copy link' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 500;
  padding: 0;
}

@media (min-width: 480px) {
  .overlay {
    align-items: center;
    padding: 24px;
  }
}

.dialog {
  background: var(--color-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: 24px;
  width: 100%;
  max-width: 420px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 80vh;
}

@media (min-width: 480px) {
  .dialog {
    border-radius: var(--radius-lg);
  }
}

.dialog-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dialog-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.dialog-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}

.privacy-note {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin: 0;
}

.list-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.list-info {
  font-size: 12px;
  color: var(--color-text-muted);
}

.toggle-all-btn {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--color-primary-light);
}

.month-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
}

.month-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: var(--color-bg);
  transition: background 0.1s;
}

.month-row:hover {
  background: var(--color-primary-light);
}

.month-row input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
  flex-shrink: 0;
  cursor: pointer;
}

.month-label {
  flex: 1;
  font-size: 14px;
  color: var(--color-text);
}

.month-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}

.empty-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  text-align: center;
  margin: 0;
}

.link-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.link-preview {
  width: 100%;
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.length-warning {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-warning);
  background: var(--color-warning-bg);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  margin: 0;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 4px;
  border-top: 1px solid var(--color-border);
}

.btn-cancel {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
}

.btn-secondary {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-primary {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: var(--color-primary);
  transition: opacity 0.15s;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
