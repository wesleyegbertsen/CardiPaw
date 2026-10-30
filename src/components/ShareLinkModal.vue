<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Pet, Reading } from '../types';
import { localMonthKey } from '../utils/date';
import { buildSharePayload, encodeShare, ShareTooLargeError } from '../utils/shareCodec';
import { Share } from '@capacitor/share';
import { useModal } from '../composables/useModal';
import { isNative, publicUrl } from '../utils/platform';

const props = defineProps<{ pet: Pet; readings: Reading[] }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const { locale, t } = useI18n();

const dialogRef = ref<HTMLElement | null>(null);
useModal(dialogRef, { onClose: () => emit('close') });

const availableMonths = computed(() => {
  const set = new Set(props.readings.map(r => localMonthKey(r.date)));
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
  return new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(
    new Date(key + '-15')
  );
}

function countReadings(monthKey: string): number {
  return props.readings.filter(r => localMonthKey(r.date) === monthKey).length;
}

const shareUrl = ref('');
const encodeFailed = ref(false);
const tooLarge = ref(false);
let encodeToken = 0;

watch(
  selectedMonths,
  async (months) => {
    const token = ++encodeToken;
    // Never leave the previous link up while the new one is encoded: Copy would share deselected months.
    shareUrl.value = '';
    encodeFailed.value = false;
    tooLarge.value = false;
    if (months.length === 0) return;
    const payload = buildSharePayload(props.pet, props.readings, months);
    let encoded: string;
    try {
      encoded = await encodeShare(payload);
    } catch (e) {
      if (token !== encodeToken) return;
      if (e instanceof ShareTooLargeError) {
        tooLarge.value = true;
      } else {
        console.error('Share link encoding failed', e);
        encodeFailed.value = true;
      }
      return;
    }
    if (token !== encodeToken) return; // a newer selection superseded this one
    const href = router.resolve({ name: 'share', query: { d: encoded } }).href;
    shareUrl.value = publicUrl(href);
  },
  { immediate: true }
);

// Some email/chat apps truncate very long URLs
const isLongUrl = computed(() => shareUrl.value.length > 8000);

// The Android WebView has no Web Share API; the app uses the Share plugin instead.
const canNativeShare = isNative() || typeof navigator.share === 'function';
const copied = ref(false);
// Screen readers skip a live region whose text comes back unchanged within one update,
// so a repeat copy blanks the region briefly; the button keeps its text
const copiedPaused = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let copiedPauseTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => {
  clearTimeout(copiedTimer);
  clearTimeout(copiedPauseTimer);
});

async function copyLink() {
  if (!shareUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    if (copied.value) {
      copiedPaused.value = true;
      clearTimeout(copiedPauseTimer);
      copiedPauseTimer = setTimeout(() => (copiedPaused.value = false), 100);
    }
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
    const data = { title: t('shareModal.shareSubject', { name: props.pet.name }), url: shareUrl.value };
    await (isNative()
      ? Share.share({ ...data, dialogTitle: t('shareModal.shareDialogTitle') })
      : navigator.share(data));
  } catch {
    // User dismissed the share sheet
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" aria-labelledby="share-modal-title" tabindex="-1">
        <div class="dialog-header">
          <h2 class="dialog-title" id="share-modal-title">{{ $t('shareModal.title') }}</h2>
          <p class="dialog-subtitle">{{ pet.name }}</p>
        </div>

        <p class="privacy-note">{{ $t('shareModal.privacyNote') }}</p>

        <div class="list-controls">
          <span class="list-info">
            {{ $t('shareModal.monthsAvailable', availableMonths.length) }}
          </span>
          <button class="toggle-all-btn" @click="toggleAll">
            {{ allSelected ? $t('shareModal.clearAll') : $t('shareModal.selectAll') }}
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
          {{ $t('shareModal.selectAtLeastOne') }}
        </p>

        <div v-else class="link-section">
          <input class="link-preview" :value="shareUrl" :aria-label="$t('shareModal.title')" readonly @focus="($event.target as HTMLInputElement).select()" />
          <p v-if="encodeFailed" class="encode-error" role="alert">{{ $t('shareModal.encodeError') }}</p>
          <p v-if="tooLarge" class="encode-error" role="alert">{{ $t('shareModal.tooLarge') }}</p>
          <p v-if="isLongUrl" class="length-warning">
            {{ $t('shareModal.lengthWarning') }}
          </p>
        </div>

        <!-- Inside the modal dialog: screen readers ignore live regions outside it -->
        <p class="sr-only" role="status">{{ copied && !copiedPaused ? $t('shareModal.copied') : '' }}</p>

        <div class="dialog-footer">
          <button class="btn-cancel" @click="emit('close')">{{ $t('common.close') }}</button>
          <button v-if="canNativeShare" class="btn-secondary" @click="nativeShare" :disabled="!shareUrl">
            {{ $t('shareModal.shareNative') }}
          </button>
          <button class="btn-primary" @click="copyLink" :disabled="!shareUrl">
            {{ copied ? $t('shareModal.copied') : $t('shareModal.copyLink') }}
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
  padding-bottom: calc(24px + var(--safe-bottom));
  width: 100%;
  max-width: 420px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 80vh;
  outline: none;
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

.length-warning,
.encode-error {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-warning);
  background: var(--color-warning-bg);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  margin: 0;
}

.encode-error {
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
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
