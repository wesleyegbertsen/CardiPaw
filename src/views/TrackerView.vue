<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { useAudioBeep } from '../composables/useAudioBeep';

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();
const readingsStore = useReadingsStore();
const { playDoneSound } = useAudioBeep();

const petId = route.params.id as string;
const pet = computed(() => petsStore.getPetById(petId));

type Phase = 'idle' | 'running' | 'done';
const phase = ref<Phase>('idle');
const timeLeft = ref(30);
const clickCount = ref(0);
const intervalId = ref<ReturnType<typeof setInterval> | null>(null);
const isPulsing = ref(false);
const saving = ref(false);

const resultRate = computed(() => clickCount.value * 2);

function handleHeartClick() {
  if (phase.value === 'idle') {
    startTracking();
  } else if (phase.value === 'running') {
    registerBreath();
  }
}

function startTracking() {
  phase.value = 'running';
  clickCount.value = 1; // first click counts as the first breath
  triggerPulse();
  intervalId.value = setInterval(tick, 1000);
}

function registerBreath() {
  clickCount.value++;
  triggerPulse();
}

function tick() {
  timeLeft.value--;
  if (timeLeft.value <= 0) {
    stopTracking();
  }
}

function stopTracking() {
  if (intervalId.value !== null) {
    clearInterval(intervalId.value);
    intervalId.value = null;
  }
  phase.value = 'done';
  playDoneSound();
}

function triggerPulse() {
  isPulsing.value = true;
  setTimeout(() => { isPulsing.value = false; }, 180);
}

async function saveReading() {
  if (saving.value) return;
  saving.value = true;
  try {
    await readingsStore.addReading({
      petId,
      date: new Date().toISOString(),
      rate: resultRate.value,
      clickCount: clickCount.value,
    });
    router.push({ name: 'pet', params: { id: petId } });
  } finally {
    saving.value = false;
  }
}

function discard() {
  router.push({ name: 'pet', params: { id: petId } });
}

function reset() {
  if (intervalId.value !== null) {
    clearInterval(intervalId.value);
    intervalId.value = null;
  }
  phase.value = 'idle';
  timeLeft.value = 30;
  clickCount.value = 0;
  isPulsing.value = false;
}

onUnmounted(() => {
  if (intervalId.value !== null) clearInterval(intervalId.value);
});
</script>

<template>
  <div class="tracker" :class="`phase-${phase}`">
    <header class="tracker-header">
      <button class="back-btn" @click="discard" aria-label="Go back">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
      <span class="pet-name-label">{{ pet?.name }}</span>
      <div style="width: 32px;"></div>
    </header>

    <!-- Idle state -->
    <div v-if="phase === 'idle'" class="tracker-body">
      <p class="instruction">Tap the heart each time you see your pet's chest rise and fall.</p>

      <button class="heart-btn" :class="{ pulsing: isPulsing }" @click="handleHeartClick" aria-label="Tap to start">
        <svg class="heart-svg" viewBox="0 0 100 90" fill="currentColor">
          <path d="M50 85 C50 85 5 55 5 28 C5 13 17 3 30 3 C39 3 47 8 50 15 C53 8 61 3 70 3 C83 3 95 13 95 28 C95 55 50 85 50 85Z"/>
        </svg>
      </button>

      <p class="tap-hint">Tap to start</p>
      <p class="timer-note">30-second measurement</p>
    </div>

    <!-- Running state -->
    <div v-else-if="phase === 'running'" class="tracker-body">
      <div class="timer-ring">
        <svg viewBox="0 0 120 120" class="ring-svg">
          <circle cx="60" cy="60" r="54" class="ring-track" />
          <circle
            cx="60" cy="60" r="54"
            class="ring-progress"
            :stroke-dashoffset="339.3 - (339.3 * (30 - timeLeft) / 30)"
          />
        </svg>
        <div class="timer-text">
          <span class="timer-number">{{ timeLeft }}</span>
          <span class="timer-unit">sec</span>
        </div>
      </div>

      <button class="heart-btn large" :class="{ pulsing: isPulsing }" @click="handleHeartClick" aria-label="Tap for each breath">
        <svg class="heart-svg" viewBox="0 0 100 90" fill="currentColor">
          <path d="M50 85 C50 85 5 55 5 28 C5 13 17 3 30 3 C39 3 47 8 50 15 C53 8 61 3 70 3 C83 3 95 13 95 28 C95 55 50 85 50 85Z"/>
        </svg>
      </button>

      <div class="breath-count">
        <span class="count-number">{{ clickCount }}</span>
        <span class="count-label">breaths counted</span>
      </div>
    </div>

    <!-- Done state -->
    <div v-else class="tracker-body done-body">
      <div class="done-icon">
        <svg viewBox="0 0 100 90" fill="currentColor" width="80" height="80">
          <path d="M50 85 C50 85 5 55 5 28 C5 13 17 3 30 3 C39 3 47 8 50 15 C53 8 61 3 70 3 C83 3 95 13 95 28 C95 55 50 85 50 85Z"/>
        </svg>
      </div>

      <div class="result">
        <div class="result-number">{{ resultRate }}</div>
        <div class="result-label">breaths per minute</div>
      </div>

      <p class="result-note">Based on {{ clickCount }} breaths in 30 seconds</p>

      <div class="done-actions">
        <button class="btn-save" @click="saveReading" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save result' }}
        </button>
        <button class="btn-retry" @click="reset">Try again</button>
        <button class="btn-discard" @click="discard">Discard</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tracker {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.tracker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.back-btn {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
}

.pet-name-label {
  font-size: 16px;
  font-weight: 600;
}

.tracker-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  gap: 28px;
}

.instruction {
  font-size: 15px;
  color: var(--color-text-muted);
  text-align: center;
  max-width: 280px;
  line-height: 1.5;
}

/* Heart button */
.heart-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  transition: transform 0.1s;
  -webkit-tap-highlight-color: transparent;
}

.heart-btn .heart-svg {
  width: 140px;
  height: 128px;
  fill: var(--color-primary);
  filter: drop-shadow(0 8px 24px rgba(224, 92, 122, 0.35));
  transition: transform 0.15s ease, filter 0.15s;
}

.heart-btn.large .heart-svg {
  width: 160px;
  height: 145px;
}

.heart-btn.pulsing .heart-svg {
  transform: scale(1.18);
  filter: drop-shadow(0 12px 32px rgba(224, 92, 122, 0.55));
}

.heart-btn:active .heart-svg {
  transform: scale(0.93);
}

.tap-hint {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
}

.timer-note {
  font-size: 13px;
  color: var(--color-text-muted);
}

/* Timer ring */
.timer-ring {
  position: relative;
  width: 120px;
  height: 120px;
}

.ring-svg {
  width: 120px;
  height: 120px;
  transform: rotate(-90deg);
}

.ring-track {
  fill: none;
  stroke: var(--color-border);
  stroke-width: 8;
}

.ring-progress {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 8;
  stroke-linecap: round;
  stroke-dasharray: 339.3;
  transition: stroke-dashoffset 0.8s linear;
}

.timer-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.timer-number {
  font-size: 32px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1;
}

.timer-unit {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

/* Breath count */
.breath-count {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.count-number {
  font-size: 48px;
  font-weight: 800;
  color: var(--color-text);
  line-height: 1;
}

.count-label {
  font-size: 13px;
  color: var(--color-text-muted);
}

/* Done state */
.done-body {
  gap: 20px;
}

.done-icon .heart-svg,
.done-icon svg {
  fill: var(--color-primary);
  opacity: 0.9;
}

.result {
  text-align: center;
}

.result-number {
  font-size: 72px;
  font-weight: 800;
  color: var(--color-primary);
  line-height: 1;
}

.result-label {
  font-size: 16px;
  color: var(--color-text-muted);
  margin-top: 4px;
}

.result-note {
  font-size: 13px;
  color: var(--color-text-muted);
}

.done-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 320px;
}

.btn-save {
  height: 52px;
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  transition: opacity 0.15s;
}

.btn-save:disabled {
  opacity: 0.5;
}

.btn-retry {
  height: 48px;
  background: var(--color-bg);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text);
}

.btn-discard {
  height: 44px;
  font-size: 14px;
  color: var(--color-text-muted);
}
</style>
