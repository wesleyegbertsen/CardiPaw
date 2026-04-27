<script setup lang="ts">
import { ref } from 'vue';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import * as db from '../services/db';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import type { ExportPayload } from '../types';

const petsStore = usePetsStore();
const readingsStore = useReadingsStore();

const importInput = ref<HTMLInputElement | null>(null);
const showImportConfirm = ref(false);
const pendingPayload = ref<ExportPayload | null>(null);
const importError = ref('');
const exportSuccess = ref(false);
const importSuccess = ref(false);

async function exportData() {
  const payload = await db.exportAllData();
  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `cardipaw-export-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  exportSuccess.value = true;
  setTimeout(() => { exportSuccess.value = false; }, 3000);
}

function triggerImport() {
  importError.value = '';
  importInput.value?.click();
}

async function onImportFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as ExportPayload;
    if (parsed.version !== 1 || !Array.isArray(parsed.pets) || !Array.isArray(parsed.readings)) {
      importError.value = 'Invalid file format. Please select a CardiPaw export file.';
      return;
    }
    pendingPayload.value = parsed;
    showImportConfirm.value = true;
  } catch {
    importError.value = 'Could not read the file. Make sure it is a valid JSON export.';
  } finally {
    if (importInput.value) importInput.value.value = '';
  }
}

async function confirmImport() {
  if (!pendingPayload.value) return;
  showImportConfirm.value = false;
  // pendingPayload is a Vue ref, so its nested objects are Vue Proxy instances.
  // IndexedDB's structured clone algorithm cannot clone Proxies, so we strip
  // reactivity by round-tripping through JSON before passing to IndexedDB.
  await db.importAllData(JSON.parse(JSON.stringify(pendingPayload.value)));
  // Reload all stores from scratch
  await petsStore.loadPets();
  Object.keys(readingsStore.readingsByPet).forEach((id) => {
    readingsStore.clearReadingsForPet(id);
  });
  pendingPayload.value = null;
  importSuccess.value = true;
  setTimeout(() => { importSuccess.value = false; }, 3000);
}

function cancelImport() {
  showImportConfirm.value = false;
  pendingPayload.value = null;
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1 class="page-title">Settings</h1>
    </header>

    <div class="content">
      <section class="section">
        <h2 class="section-title">Data</h2>
        <p class="section-desc">
          Your pet profiles and readings are stored locally on this device using IndexedDB.
          Export them to back up or transfer to another device.
        </p>

        <div class="action-cards">
          <div class="action-card">
            <div class="action-info">
              <div class="action-icon export-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7v2h14v-2H5z"/>
                </svg>
              </div>
              <div>
                <div class="action-name">Export data</div>
                <div class="action-desc">Download all pets and readings as JSON</div>
              </div>
            </div>
            <button class="action-btn" @click="exportData">
              {{ exportSuccess ? '✓ Exported' : 'Export' }}
            </button>
          </div>

          <div class="action-card">
            <div class="action-info">
              <div class="action-icon import-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <path d="M19 18v2H5v-2H3v2c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h-2zm-1-7l-1.41-1.41L13 13.17V3h-2v10.17l-3.59-3.59L6 11l6 6 6-6z"/>
                </svg>
              </div>
              <div>
                <div class="action-name">Import data</div>
                <div class="action-desc">Restore from a CardiPaw export file</div>
              </div>
            </div>
            <button class="action-btn" @click="triggerImport">
              {{ importSuccess ? '✓ Imported' : 'Import' }}
            </button>
          </div>
        </div>

        <input
          ref="importInput"
          type="file"
          accept=".json,application/json"
          class="sr-only"
          @change="onImportFileChange"
        />

        <p v-if="importError" class="error-msg">{{ importError }}</p>
      </section>

      <section class="section about-section">
        <h2 class="section-title">About</h2>
        <p class="about-text">
          CardiPaw helps you track your pet's resting respiratory rate (RRR) —
          an important health indicator for pets with heart conditions like HCM.
        </p>
        <div class="thresholds">
          <div class="threshold-row">
            <span class="threshold-label">Normal</span>
            <span class="threshold-value">≤ 30 breaths/min</span>
          </div>
          <div class="threshold-row">
            <span class="threshold-label">Elevated</span>
            <span class="threshold-value">31–35 breaths/min</span>
          </div>
          <div class="threshold-row">
            <span class="threshold-label">High</span>
            <span class="threshold-value">&gt; 35 breaths/min</span>
          </div>
        </div>
      </section>
    </div>

    <ConfirmDialog
      v-if="showImportConfirm"
      :message="`Import ${pendingPayload?.pets.length ?? 0} pet(s) and ${pendingPayload?.readings.length ?? 0} reading(s)? This will overwrite all existing data on this device.`"
      @confirm="confirmImport"
      @cancel="cancelImport"
    />
  </div>
</template>

<style scoped>
.page {
  min-height: 100%;
  background: var(--color-bg);
}

.page-header {
  padding: 20px 16px 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.page-title {
  font-size: 22px;
  font-weight: 700;
}

.content {
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.section {}

.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--color-text-muted);
  margin-bottom: 12px;
}

.section-desc {
  font-size: 14px;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin-bottom: 16px;
}

.action-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.action-info {
  display: flex;
  align-items: center;
  gap: 14px;
}

.action-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.export-icon {
  background: var(--color-icon-export-bg);
  color: var(--color-icon-export-text);
}

.import-icon {
  background: var(--color-icon-import-bg);
  color: var(--color-icon-import-text);
}

.action-name {
  font-size: 15px;
  font-weight: 600;
}

.action-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.action-btn {
  padding: 8px 18px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  background: var(--color-bg);
  flex-shrink: 0;
  transition: background 0.15s;
}

.action-btn:active {
  background: var(--color-border);
}

.error-msg {
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-danger);
  background: var(--color-danger-bg);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

.about-text {
  font-size: 14px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin-bottom: 16px;
}

.thresholds {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.threshold-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.threshold-label {
  font-weight: 500;
}

.threshold-value {
  color: var(--color-text-muted);
  font-size: 13px;
}
</style>
