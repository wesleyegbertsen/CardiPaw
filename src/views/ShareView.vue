<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { Reading, SharePayload } from '../types';
import { decodeShare } from '../utils/shareCodec';
import { getRateStatus } from '../utils/rateStatus';
import { useAgeCalculator } from '../composables/useAgeCalculator';
import RRRChart from '../components/RRRChart.vue';

// Standalone read-only viewer for shared snapshots. Renders entirely from the
// URL payload — it never touches the stores or IndexedDB, so opening a link on
// the owner's own device cannot mix with or mutate local data.

const route = useRoute();

const state = ref<'loading' | 'error' | 'ready'>('loading');
const payload = ref<SharePayload | null>(null);

// Re-decode whenever the query changes: hash-only navigation between share
// links reuses the mounted component, so onMounted alone would show stale data
watch(
  () => route.query.d,
  async (d) => {
    if (route.name !== 'share') return;
    state.value = 'loading';
    payload.value = null;
    if (typeof d !== 'string' || d.length === 0) {
      state.value = 'error';
      return;
    }
    try {
      payload.value = await decodeShare(d);
      state.value = 'ready';
    } catch {
      state.value = 'error';
    }
  },
  { immediate: true }
);

const pet = computed(() => payload.value?.pet ?? null);
const birthdateRef = computed(() => pet.value?.birthdate ?? '');
const ageDisplay = useAgeCalculator(birthdateRef);

const sharedAtLabel = computed(() => {
  if (!payload.value) return '';
  return new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(
    new Date(payload.value.sharedAt + 'T12:00:00')
  );
});

const allReadings = computed(() => payload.value?.readings ?? []);

const stats = computed(() => {
  const rates = allReadings.value.map((r) => r.rate);
  if (rates.length === 0) return null;
  const counts = { normal: 0, warning: 0, danger: 0 };
  for (const rate of rates) {
    counts[getRateStatus(rate, pet.value ?? undefined).cssClass as keyof typeof counts]++;
  }
  return {
    total: rates.length,
    avg: Math.round(rates.reduce((s, r) => s + r, 0) / rates.length),
    min: Math.min(...rates),
    max: Math.max(...rates),
    counts,
  };
});

type SharedReading = SharePayload['readings'][number];

interface MonthSection {
  key: string;
  label: string;
  chartReadings: Reading[];
  rows: SharedReading[];
}

const monthSections = computed<MonthSection[]>(() => {
  const groups = new Map<string, SharedReading[]>();
  for (const r of allReadings.value) {
    const key = r.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, readings]) => ({
      key,
      label: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(
        new Date(key + '-15')
      ),
      chartReadings: [...readings]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ id: r.date, petId: 'shared', date: r.date, rate: r.rate, clickCount: 0 })),
      rows: [...readings].sort((a, b) => b.date.localeCompare(a.date)),
    }));
});

function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

function restStateLabel(reading: SharedReading): string {
  if (reading.restState === 'resting') return 'Resting';
  if (reading.restState === 'sleeping') return 'Sleeping';
  return '';
}
</script>

<template>
  <div class="share-page">
    <div class="share-banner">
      <span class="brand">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
        CardiPaw
      </span>
      <span v-if="state === 'ready'" class="banner-info">Shared snapshot · {{ sharedAtLabel }}</span>
    </div>

    <div v-if="state === 'loading'" class="status-msg">Loading snapshot…</div>

    <div v-else-if="state === 'error'" class="error-card">
      <h1>This link is invalid or incomplete</h1>
      <p>
        The shared data could not be read. The link may have been truncated by
        the app it was sent through — ask the sender to share it again, with
        fewer months selected if it was very long.
      </p>
    </div>

    <template v-else-if="pet">
      <div class="pet-hero">
        <h1 class="pet-name">{{ pet.name }}</h1>
        <div class="pet-meta">
          <span class="badge" :class="pet.species">{{ pet.species }}</span>
          <span class="meta-dot">·</span>
          <span>{{ ageDisplay }}</span>
        </div>
        <p class="report-title">Resting Respiratory Rate report</p>
      </div>

      <div v-if="stats" class="summary-card">
        <div class="stat-grid">
          <div class="stat">
            <span class="stat-value">{{ stats.total }}</span>
            <span class="stat-label">Readings</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ stats.avg }}</span>
            <span class="stat-label">Average</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ stats.min }}</span>
            <span class="stat-label">Lowest</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ stats.max }}</span>
            <span class="stat-label">Highest</span>
          </div>
        </div>
        <div class="status-breakdown">
          <span class="rate-badge normal">{{ stats.counts.normal }} Normal</span>
          <span class="rate-badge warning">{{ stats.counts.warning }} Elevated</span>
          <span class="rate-badge danger">{{ stats.counts.danger }} High</span>
        </div>
      </div>

      <section v-for="month in monthSections" :key="month.key" class="month-section">
        <h2 class="month-title">{{ month.label }}</h2>
        <RRRChart :readings="month.chartReadings" :max-ticks="6" :normal-ceiling="pet.normalCeiling" />
        <div class="reading-table">
          <div v-for="row in month.rows" :key="row.date" class="reading-row">
            <div class="row-left">
              <span class="row-date">{{ formatDateTime(row.date) }}</span>
              <span v-if="restStateLabel(row)" class="row-rest">{{ restStateLabel(row) }}</span>
            </div>
            <div class="row-right">
              <span class="row-rate">{{ row.rate }} <span class="rate-unit">breaths/min</span></span>
              <span class="rate-badge" :class="getRateStatus(row.rate, pet).cssClass">
                {{ getRateStatus(row.rate, pet).label }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <footer class="share-footer">
        <p>
          Created with <a href="https://cardipaw.com/" target="_blank" rel="noopener">CardiPaw</a>.
          The data lives entirely in this link — nothing was uploaded or stored
          by opening this page.
        </p>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.share-page {
  max-width: 640px;
  margin: 0 auto;
  padding: 16px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.share-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
}

.brand {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-primary);
}

.banner-info {
  font-size: 12px;
  color: var(--color-text-muted);
}

.status-msg {
  padding: 48px 0;
  text-align: center;
  font-size: 14px;
  color: var(--color-text-muted);
}

.error-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: 32px 24px;
  text-align: center;
}

.error-card h1 {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}

.error-card p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.pet-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.pet-name {
  font-size: 26px;
  font-weight: 700;
}

.pet-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--color-text-muted);
}

.badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.badge.cat { background: var(--color-badge-cat-bg); color: var(--color-badge-cat-text); }
.badge.dog { background: var(--color-badge-dog-bg); color: var(--color-badge-dog-text); }

.meta-dot { font-size: 18px; }

.report-title {
  font-size: 13px;
  color: var(--color-text-muted);
}

.summary-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
}

.stat-label {
  font-size: 11px;
  color: var(--color-text-muted);
}

.status-breakdown {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.month-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.month-title {
  font-size: 16px;
  font-weight: 700;
  margin-top: 8px;
}

.reading-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.row-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row-date {
  font-size: 13px;
  color: var(--color-text-muted);
}

.row-rest {
  font-size: 11px;
  color: var(--color-text-muted);
}

.row-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.row-rate {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text);
  white-space: nowrap;
}

.rate-unit {
  font-size: 11px;
  font-weight: 400;
  color: var(--color-text-muted);
}

/* min-width fits the longest label ("Elevated") so all pills are equal width */
.rate-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  min-width: 72px;
  text-align: center;
}

.rate-badge.normal {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.rate-badge.warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.rate-badge.danger {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}

.share-footer {
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-muted);
  padding-top: 8px;
}

.share-footer a {
  color: var(--color-primary);
  font-weight: 600;
}

@media print {
  .share-page {
    max-width: none;
    padding: 0;
  }

  .share-banner,
  .pet-hero,
  .summary-card,
  .reading-row {
    box-shadow: none;
    border: 1px solid var(--color-border);
  }

  .month-section {
    break-inside: avoid;
  }
}
</style>
