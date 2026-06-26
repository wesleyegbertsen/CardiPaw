<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Reading, SharePayload } from '../types';
import { decodeShare } from '../utils/shareCodec';
import { getRateStatus } from '../utils/rateStatus';
import { useAgeCalculator } from '../composables/useAgeCalculator';
import RRRChart from '../components/RRRChart.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import LocalePicker from '../components/LocalePicker.vue';

// Standalone read-only viewer for shared snapshots. Renders entirely from the
// URL payload — it never touches the stores or IndexedDB, so opening a link on
// the owner's own device cannot mix with or mutate local data.

const route = useRoute();
const { locale } = useI18n();

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
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(
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
      label: new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(
        new Date(key + '-15')
      ),
      chartReadings: [...readings]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ id: r.date, petId: 'shared', date: r.date, rate: r.rate, clickCount: 0 })),
      rows: [...readings].sort((a, b) => b.date.localeCompare(a.date)),
    }));
});

function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
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
      <span v-if="state === 'ready'" class="banner-info">{{ $t('share.bannerInfo', { date: sharedAtLabel }) }}</span>
      <div class="banner-controls">
        <ThemeToggle />
        <LocalePicker />
      </div>
    </div>

    <div v-if="state === 'loading'" class="status-msg">{{ $t('share.loading') }}</div>

    <div v-else-if="state === 'error'" class="error-card">
      <h1>{{ $t('share.errorTitle') }}</h1>
      <p>{{ $t('share.errorBody') }}</p>
    </div>

    <template v-else-if="pet">
      <div class="pet-hero">
        <h1 class="pet-name">{{ pet.name }}</h1>
        <div class="pet-meta">
          <span class="badge" :class="pet.species">{{ $t('species.' + pet.species) }}</span>
          <span class="meta-dot">·</span>
          <span>{{ ageDisplay }}</span>
        </div>
        <p class="report-title">{{ $t('share.reportTitle') }}</p>
      </div>

      <div v-if="stats" class="summary-card">
        <div class="stat-grid">
          <div class="stat">
            <span class="stat-value">{{ stats.total }}</span>
            <span class="stat-label">{{ $t('share.readings') }}</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ stats.avg }}</span>
            <span class="stat-label">{{ $t('share.average') }}</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ stats.min }}</span>
            <span class="stat-label">{{ $t('share.lowest') }}</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ stats.max }}</span>
            <span class="stat-label">{{ $t('share.highest') }}</span>
          </div>
        </div>
        <div class="status-breakdown">
          <span class="rate-badge normal">{{ $t('share.countNormal', { count: stats.counts.normal }) }}</span>
          <span class="rate-badge warning">{{ $t('share.countElevated', { count: stats.counts.warning }) }}</span>
          <span class="rate-badge danger">{{ $t('share.countHigh', { count: stats.counts.danger }) }}</span>
        </div>
      </div>

      <section v-for="month in monthSections" :key="month.key" class="month-section">
        <h2 class="month-title">{{ month.label }}</h2>
        <RRRChart :readings="month.chartReadings" :max-ticks="6" :normal-ceiling="pet.normalCeiling" />
        <div class="reading-table">
          <div v-for="row in month.rows" :key="row.date" class="reading-row">
            <div class="row-left">
              <span class="row-date">{{ formatDateTime(row.date) }}</span>
            </div>
            <div class="row-right">
              <span class="row-rate">{{ row.rate }} <span class="rate-unit">{{ $t('common.breathsPerMin') }}</span></span>
              <div class="pill-col">
                <span class="rate-badge" :class="getRateStatus(row.rate, pet).cssClass">
                  {{ $t('status.' + getRateStatus(row.rate, pet).cssClass) }}
                </span>
                <span v-if="row.restState === 'resting'" class="rest-tag resting">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                    <path d="M21 9V7c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v2c-1.1 0-2 .9-2 2v5h1.33L3 18h1l.67-2h14.67l.66 2h1l-.33-2H23v-5c0-1.1-.9-2-2-2zm-8 0H5V7h8v2zm6 0h-4V7h4v2z"/>
                  </svg>
                  {{ $t('restState.resting') }}
                </span>
                <span v-else-if="row.restState === 'sleeping'" class="rest-tag sleeping">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
                  </svg>
                  {{ $t('restState.sleeping') }}
                </span>
                <span v-if="row.source === 'manual'" class="source-tag">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                  {{ $t('source.manual') }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer class="share-footer">
        <p v-html="$t('share.footer')"></p>
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
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
}

.banner-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

/* The toggle/picker use white-on-dark styles for the home header gradient.
   Override them here to suit the light primary-light banner background. */
.banner-controls :deep(.theme-toggle),
.banner-controls :deep(.lang-trigger) {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.15);
}

.banner-controls :deep(.theme-toggle):hover,
.banner-controls :deep(.lang-trigger):hover {
  background: rgba(0, 0, 0, 0.1);
  border-color: rgba(0, 0, 0, 0.25);
}

.banner-controls :deep(.theme-toggle-label),
.banner-controls :deep(.lang-chevron) {
  color: var(--color-primary);
}

.banner-controls :deep(.theme-toggle-thumb) {
  background: var(--color-primary);
  color: #fff;
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
  text-align: center;
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
  min-width: 0;
}

.row-date {
  font-size: 13px;
  color: var(--color-text-muted);
}

.rest-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

/* one fixed width for both pill types, sized to the widest content
   (icon + "Sleeping"), so they stack as an equal-width column and the
   rate text aligns across rows */
.rest-tag,
.reading-row .rate-badge {
  width: 88px;
}

.rest-tag.resting {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.rest-tag.sleeping {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.source-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  width: 88px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}

.row-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.pill-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.rate-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-full);
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
