<script setup lang="ts">
import { ref } from 'vue';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import * as db from '../services/db';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import InfoModal from '../components/InfoModal.vue';
import type { ExportPayload } from '../types';

const petsStore = usePetsStore();
const readingsStore = useReadingsStore();

const importInput = ref<HTMLInputElement | null>(null);
const showImportConfirm = ref(false);
const activeModal = ref<'privacy' | 'terms' | null>(null);
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
        <p class="disclaimer-text">
          These are the global default thresholds. You can configure custom ceilings per pet in each
          pet's profile. Always follow your veterinarian's specific guidance on what values to monitor,
          what ranges are normal for your pet, and when to seek care.
        </p>
      </section>

      <section class="section">
        <h2 class="section-title">Legal</h2>
        <div class="action-cards">
          <div class="action-card">
            <div class="action-info">
              <div class="action-icon legal-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 16h8v1.5H8V16zm0-3h8v1.5H8V13zm0-3h5v1.5H8V10z"/>
                </svg>
              </div>
              <div>
                <div class="action-name">Privacy Policy</div>
                <div class="action-desc">How your data is stored and used</div>
              </div>
            </div>
            <button class="action-btn" @click="activeModal = 'privacy'">View</button>
          </div>

          <div class="action-card">
            <div class="action-info">
              <div class="action-icon legal-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l5 2.18V11c0 3.5-2.33 6.79-5 7.93-2.67-1.14-5-4.43-5-7.93V7.18L12 5zm-1 4v4h2V9h-2zm0 6v2h2v-2h-2z"/>
                </svg>
              </div>
              <div>
                <div class="action-name">Terms of Use</div>
                <div class="action-desc">Conditions and disclaimers for using CardiPaw</div>
              </div>
            </div>
            <button class="action-btn" @click="activeModal = 'terms'">View</button>
          </div>

          <div class="action-card">
            <div class="action-info">
              <div class="action-icon legal-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
                </svg>
              </div>
              <div>
                <div class="action-name">Source Code</div>
                <div class="action-desc">CardiPaw is open source on GitHub</div>
              </div>
            </div>
            <a
              class="action-btn"
              href="https://github.com/wesleyegbertsen/CardiPaw"
              target="_blank"
              rel="noopener noreferrer"
            >View</a>
          </div>
        </div>
      </section>
    </div>

    <InfoModal
      v-if="activeModal === 'privacy'"
      title="Privacy Policy"
      @close="activeModal = null"
    >
      <p><strong>Your data stays on your device.</strong> CardiPaw stores all information (pet profiles, readings, and notes) exclusively in your browser's IndexedDB. Nothing is ever transmitted to a server.</p>
      <p><strong>No tracking or analytics.</strong> CardiPaw does not use cookies, analytics services, advertising trackers, or any third-party data collection. There are no user accounts and no login.</p>
      <p><strong>You are in control.</strong> You can export your data at any time from the Settings page, and deleting the app or clearing your browser's site data will permanently remove everything.</p>
      <p><strong>No data sharing.</strong> Because your data never leaves your device, it is never shared with or accessible by anyone else.</p>
    </InfoModal>

    <InfoModal
      v-if="activeModal === 'terms'"
      title="Terms of Use"
      @close="activeModal = null"
    >
      <p><strong>Not medical advice.</strong> CardiPaw is an informational tool to help you log and track your pet's resting respiratory rate. It is not a substitute for professional veterinary diagnosis, advice, or treatment.</p>
      <p><strong>Consult your veterinarian.</strong> Always follow your vet's specific guidance on what values to monitor, what ranges are normal for your individual pet, and when to seek care. Do not make medical decisions based solely on this app.</p>
      <p><strong>No warranties.</strong> CardiPaw is provided free of charge, as-is, without any warranties of any kind (express or implied). The developer is not liable for any decisions made based on data logged in this app.</p>
      <p><strong>Use at your own risk.</strong> By using CardiPaw you accept full responsibility for how you interpret and act on the data it presents.</p>
    </InfoModal>

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

.legal-icon {
  background: var(--color-primary-light);
  color: var(--color-primary);
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

.disclaimer-text {
  margin-top: 16px;
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.6;
}
</style>
