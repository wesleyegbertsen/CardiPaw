<script setup lang="ts">
import { ref, computed } from 'vue';

const emit = defineEmits<{ close: [] }>();

const steps = ['rest', 'watch', 'count', 'avoid'] as const;
const step = ref(0);
const isLastStep = computed(() => step.value === steps.length - 1);

function next() {
  if (isLastStep.value) {
    emit('close');
  } else {
    step.value++;
  }
}

function back() {
  if (step.value > 0) step.value--;
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="dialog" role="dialog" aria-modal="true" :aria-label="$t('onboarding.howItWorks')">
        <div class="dialog-header">
          <span class="step-count">{{ $t('onboarding.stepCount', { current: step + 1, total: steps.length }) }}</span>
          <button class="btn-skip" @click="emit('close')">{{ $t('onboarding.skip') }}</button>
        </div>

        <div class="dialog-body">
          <div class="icon-badge">
            <svg v-if="step === 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
            </svg>
            <svg v-else-if="step === 1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 13h3.5l2-6 3.5 12 2.5-9 1.5 3H21" />
            </svg>
            <svg v-else-if="step === 2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l3 2" />
              <path d="M9 2h6" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3 2 20h20L12 3Z" />
              <path d="M12 9v5" />
              <path d="M12 17h.01" />
            </svg>
          </div>
          <h2 class="step-title">{{ $t(`onboarding.step${step + 1}Title`) }}</h2>
          <p class="step-body">{{ $t(`onboarding.step${step + 1}Body`) }}</p>
        </div>

        <div class="dialog-footer">
          <div class="dots">
            <span v-for="(s, i) in steps" :key="s" class="dot" :class="{ active: i === step }" />
          </div>
          <div class="footer-actions">
            <button v-if="step > 0" class="btn-back" @click="back">{{ $t('onboarding.back') }}</button>
            <button class="btn-next" @click="next">{{ isLastStep ? $t('onboarding.gotIt') : $t('onboarding.next') }}</button>
          </div>
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
  align-items: center;
  justify-content: center;
  z-index: 700;
  padding: 24px;
}

.dialog {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  max-width: 380px;
  width: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 0;
}

.step-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
}

.btn-skip {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  padding: 4px 6px;
}

.dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 16px 28px 8px;
}

.icon-badge {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-light);
  color: var(--color-primary);
  flex-shrink: 0;
}

.icon-badge svg {
  width: 28px;
  height: 28px;
}

.step-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text);
  margin: 0;
  min-height: calc(1.3em * 2);
  display: flex;
  align-items: center;
}

.step-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-muted);
  margin: 0;
  min-height: calc(1.6em * 5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 8px 20px 20px;
}

.dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-border);
  transition: background 0.2s, transform 0.2s;
}

.dot.active {
  background: var(--color-primary);
  transform: scale(1.3);
}

.footer-actions {
  display: flex;
  gap: 10px;
  width: 100%;
}

.btn-back {
  flex: 1;
  height: 44px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  background: var(--color-bg);
}

.btn-next {
  flex: 2;
  height: 44px;
  background: var(--color-primary);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
}
</style>
