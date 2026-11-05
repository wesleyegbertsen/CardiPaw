<script setup lang="ts">
/**
 * The camera breath count, from the explanation to the verdict. Owns the preview video for its
 * whole life (the composable holds a ref to it); the surrounding chrome switches with the phase.
 * An accepted verdict is emitted as a suggestion and rendered by the tracker, which alone saves.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import SlideToggle from './SlideToggle.vue';
import { useCameraBreath, type CameraResult } from '../composables/useCameraBreath';
import { FRAME_HEIGHT, FRAME_WIDTH, defaultRoi, type CaptureReason } from '../camera/capture';
import type { Pet } from '../types';

const props = defineProps<{ pet: Pet; autoOpen?: boolean }>();
const emit = defineEmits<{ result: [CameraResult]; tapInstead: []; busy: [boolean] }>();

const { t } = useI18n();
const video = ref<HTMLVideoElement | null>(null);
// Focus targets: the alert of an error or an abstain, and the placing instruction.
const alertRef = ref<HTMLElement | null>(null);
const placeRef = ref<HTMLElement | null>(null);
const cam = useCameraBreath({ pet: computed(() => props.pet), video });

// The box the owner frames the chest in, derived from the same function the tracker uses.
const { roi } = defaultRoi({ width: FRAME_WIDTH, height: FRAME_HEIGHT });
const pct = (f: number) => `${(100 * f).toFixed(2)}%`;
const roiBoxStyle = {
  left: pct(roi.x / FRAME_WIDTH),
  top: pct(roi.y / FRAME_HEIGHT),
  width: pct(roi.w / FRAME_WIDTH),
  height: pct(roi.h / FRAME_HEIGHT),
};

const countAlong = ref(false);
const taps = ref(0);
const isPulsing = ref(false);
let pulseTimer: ReturnType<typeof setTimeout> | undefined;
const countAlongLabelId = useId();
const countAlongHintId = useId();

// Placing and capturing: the preview shows and the tracker hides its mode bar.
const busy = computed(() => cam.phase.value === 'placing' || cam.phase.value === 'capturing');

const errorKey = computed(() => {
  switch (cam.error.value) {
    case 'denied':
      return 'camera.denied';
    case 'no-camera':
      return 'camera.noCamera';
    case 'busy':
      return 'camera.busy';
    case 'unsupported':
      return 'camera.unsupported';
    case 'interrupted':
      return 'camera.interrupted';
    default:
      return 'camera.failed';
  }
});

const placementHint = computed(() => {
  const p = cam.placement.value;
  if (p.tooDark) return 'camera.tooDark';
  if (p.moving) return 'camera.moving';
  if (p.steady) return 'camera.steady';
  return null;
});

const liveHint = computed(() => {
  const h = cam.hints.value;
  if (h.shake) return 'camera.hintShake';
  if (h.fewTracks) return 'camera.hintFewTracks';
  if (h.tooDark) return 'camera.hintDark';
  return null;
});

const ringOffset = computed(() => 339.3 * (1 - cam.elapsedSeconds.value / cam.targetSeconds.value));

// Changes exactly at 10, 20, 30… seconds, so the live region speaks once per ten seconds.
const announce = computed(() =>
  cam.phase.value === 'capturing' && cam.elapsedSeconds.value >= 10
    ? t('camera.phaseAnnounce', { n: Math.floor(cam.elapsedSeconds.value / 10) * 10 })
    : '',
);

// The first matching reason wins: shake explains everything after it, and so on down.
const ABSTAIN_HINTS: [CaptureReason, string][] = [
  ['shake', 'camera.abstain.shake'],
  ['few-tracks', 'camera.abstain.fewTracks'],
  ['frame-rate', 'camera.abstain.frameRate'],
  ['fast-motion', 'camera.abstain.fastMotion'],
  ['twitch', 'camera.abstain.twitch'],
  ['irregular', 'camera.abstain.irregular'],
  ['estimators-disagree', 'camera.abstain.irregular'],
  ['no-signal', 'camera.abstain.noSignal'],
  ['weak-periodicity', 'camera.abstain.noSignal'],
  ['too-short', 'camera.abstain.tooShort'],
  ['low-quality', 'camera.abstain.lowQuality'],
];
const abstained = computed(() => cam.phase.value === 'done' && !cam.verdict.value?.accepted);
const abstainHint = computed(() => {
  const reasons = cam.verdict.value?.reasons ?? [];
  return (
    ABSTAIN_HINTS.find(([reason]) => reasons.includes(reason))?.[1] ?? 'camera.abstain.lowQuality'
  );
});

watch(busy, (b) => emit('busy', b), { immediate: true });
// The chrome switches with the phase and the focused button goes with it; put focus where the
// owner is, so a screen reader reads the new state and Tab starts at its actions.
watch(cam.phase, (p) => {
  nextTick(() => {
    if (p === 'placing') placeRef.value?.focus();
    else if (p === 'error' || abstained.value) alertRef.value?.focus();
  });
});
watch(cam.verdict, (v) => {
  if (v?.accepted && v.rate !== null && v.interval) {
    emit('result', {
      rate: v.rate,
      seconds: v.seconds,
      interval: [v.interval[0], v.interval[1]], // a copy: the verdict is readonly
      taps: taps.value >= 3 ? taps.value : null,
    });
  }
});

function begin() {
  taps.value = 0;
  cam.begin();
}

function tap() {
  if (cam.phase.value !== 'capturing') return;
  taps.value++;
  isPulsing.value = true;
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => {
    isPulsing.value = false;
  }, 180);
}

onMounted(() => {
  if (props.autoOpen) void cam.open();
});
onBeforeUnmount(() => clearTimeout(pulseTimer));
</script>

<template>
  <div class="camera-capture">
    <div v-show="busy" class="preview" :class="{ small: cam.phase.value === 'capturing' }">
      <video ref="video" playsinline muted autoplay aria-hidden="true" />
      <div
        v-if="cam.phase.value === 'placing'"
        class="roi-box"
        :style="roiBoxStyle"
        aria-hidden="true"
      />
    </div>

    <!-- Explain -->
    <template v-if="cam.phase.value === 'idle'">
      <span class="experimental-chip">{{ $t('camera.experimental') }}</span>
      <h2 class="title">{{ $t('camera.explainTitle') }}</h2>
      <p class="body-text">{{ $t('camera.explainBody') }}</p>
      <p class="privacy-note">{{ $t('camera.privacyNote') }}</p>
      <div class="actions">
        <button class="btn-save" @click="cam.open()">{{ $t('camera.allow') }}</button>
        <button class="btn-discard" @click="emit('tapInstead')">
          {{ $t('camera.tapInstead') }}
        </button>
      </div>
    </template>

    <!-- Permission prompt open -->
    <div v-else-if="cam.phase.value === 'requesting'" class="requesting" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <span>{{ $t('camera.requesting') }}</span>
    </div>

    <!-- Errors, including an interrupted count -->
    <template v-else-if="cam.phase.value === 'error'">
      <p ref="alertRef" class="alert" role="alert" tabindex="-1">{{ $t(errorKey) }}</p>
      <div class="actions">
        <button v-if="cam.error.value !== 'unsupported'" class="btn-retry" @click="cam.open()">
          {{ $t('camera.retry') }}
        </button>
        <button class="btn-discard" @click="emit('tapInstead')">
          {{ $t('camera.tapInstead') }}
        </button>
      </div>
    </template>

    <!-- Placing -->
    <template v-else-if="cam.phase.value === 'placing'">
      <p ref="placeRef" class="body-text" tabindex="-1">{{ $t('camera.placeBody') }}</p>
      <p v-if="placementHint" class="placement-hint" :class="{ ready: cam.placement.value.steady }">
        {{ $t(placementHint) }}
      </p>
      <div class="actions">
        <button class="btn-save" :disabled="!cam.placement.value.steady" @click="begin">
          {{ $t('camera.start') }}
        </button>
        <div class="option-row">
          <span :id="countAlongLabelId" class="toggle-label">{{ $t('camera.countAlong') }}</span>
          <SlideToggle
            v-model="countAlong"
            :labelledby="countAlongLabelId"
            :describedby="countAlong ? countAlongHintId : undefined"
          />
        </div>
        <p v-if="countAlong" :id="countAlongHintId" class="hint">
          {{ $t('camera.countAlongHint') }}
        </p>
      </div>
    </template>

    <!-- Capturing -->
    <template v-else-if="cam.phase.value === 'capturing'">
      <div class="timer-ring">
        <svg viewBox="0 0 120 120" class="ring-svg">
          <circle cx="60" cy="60" r="54" class="ring-track" />
          <circle cx="60" cy="60" r="54" class="ring-progress" :stroke-dashoffset="ringOffset" />
        </svg>
        <div class="timer-text">
          <span class="timer-number">{{ cam.elapsedSeconds.value }}</span>
          <span class="timer-unit">{{ $t('tracker.secondsUnit') }}</span>
        </div>
      </div>
      <p class="watching">{{ $t('camera.watching') }}</p>
      <p v-if="liveHint" class="live-hint">{{ $t(liveHint) }}</p>
      <p v-if="cam.extending.value" class="hint">{{ $t('camera.extending') }}</p>
      <p v-if="cam.screenLockRefused.value" class="hint">{{ $t('camera.keepScreenOn') }}</p>
      <template v-if="countAlong">
        <button
          class="heart-btn"
          :class="{ pulsing: isPulsing }"
          :aria-label="$t('tracker.tapForBreath')"
          @click="tap"
        >
          <svg class="heart-svg" viewBox="0 0 100 90" fill="currentColor" aria-hidden="true">
            <path
              d="M50 85 C50 85 5 55 5 28 C5 13 17 3 30 3 C39 3 47 8 50 15 C53 8 61 3 70 3 C83 3 95 13 95 28 C95 55 50 85 50 85Z"
            />
          </svg>
        </button>
        <p class="hint">{{ $t('camera.tapsCounted', { n: taps }, taps) }}</p>
      </template>
      <p class="sr-only" aria-live="polite" aria-atomic="true">{{ announce }}</p>
    </template>

    <!-- Abstained; an accepted verdict is the tracker's card -->
    <template v-else-if="abstained">
      <div ref="alertRef" class="alert" role="alert" tabindex="-1">
        <p class="alert-title">{{ $t('camera.abstainTitle') }}</p>
        <p>{{ $t(abstainHint) }}</p>
        <p v-if="pet.species === 'dog'">{{ $t('camera.abstain.dog') }}</p>
      </div>
      <div class="actions">
        <button class="btn-retry" @click="cam.open()">{{ $t('camera.measureAgain') }}</button>
        <button class="btn-discard" @click="emit('tapInstead')">
          {{ $t('camera.tapInstead') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.camera-capture {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 360px;
}

.preview {
  position: relative;
  width: 100%;
  max-width: 360px;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-md);
  background: #000;
}

.preview.small {
  max-width: 240px;
}

.preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.roi-box {
  position: absolute;
  border: 2px solid #fff;
  border-radius: 6px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.title {
  font-size: 20px;
  font-weight: 700;
  text-align: center;
  margin: 0;
}

.body-text {
  font-size: 15px;
  color: var(--color-text-muted);
  text-align: center;
  line-height: 1.5;
  margin: 0;
}

.privacy-note,
.hint {
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
  line-height: 1.5;
  margin: 0;
}

.placement-hint,
.live-hint,
.watching {
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  color: var(--color-warning-text);
  margin: 0;
}

.placement-hint.ready {
  color: var(--color-success);
}

.watching {
  color: var(--color-primary);
}

.requesting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--color-text-muted);
  padding: 24px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.alert:focus,
.body-text:focus {
  outline: none;
}

.alert {
  width: 100%;
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  text-align: center;
}

.alert p {
  margin: 0;
}

.alert p + p {
  margin-top: 8px;
}

.alert-title {
  font-weight: 700;
}

.actions {
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

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toggle-label {
  font-size: 13px;
  color: var(--color-text-muted);
}

/* The ring, as on the guided tracker, counting up instead of down */
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

.heart-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  transition: transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.heart-btn .heart-svg {
  width: 96px;
  height: 88px;
  fill: var(--color-primary);
  filter: drop-shadow(0 8px 24px rgba(224, 92, 122, 0.35));
  transition:
    transform 0.15s ease,
    filter 0.15s;
}

.heart-btn.pulsing .heart-svg {
  transform: scale(1.18);
  filter: drop-shadow(0 12px 32px rgba(224, 92, 122, 0.55));
}

.heart-btn:active .heart-svg {
  transform: scale(0.93);
}
</style>
