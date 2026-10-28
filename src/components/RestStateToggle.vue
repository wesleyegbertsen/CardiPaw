<script setup lang="ts">
import { useId } from 'vue';
import type { Reading } from '../types';

type RestState = NonNullable<Reading['restState']>;

// Inline: label beside the buttons (tracker). Stacked: a form-field label above them.
withDefaults(defineProps<{ layout?: 'inline' | 'stacked' }>(), { layout: 'inline' });
const model = defineModel<RestState | undefined>();

const labelId = useId();
const STATES: RestState[] = ['resting', 'sleeping'];

// Clicking the pressed state again clears it
function toggle(state: RestState) {
  model.value = model.value === state ? undefined : state;
}
</script>

<template>
  <div class="rest-state" :class="layout">
    <span :id="labelId" class="rest-state-label">{{ $t('restState.petWas') }}</span>
    <div class="rest-state-row" role="group" :aria-labelledby="labelId">
      <button
        v-for="state in STATES"
        :key="state"
        type="button"
        class="rest-btn"
        :class="{ active: model === state }"
        :aria-pressed="model === state"
        @click="toggle(state)"
      >
        {{ $t(`restState.${state}`) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.rest-state {
  display: flex;
  gap: 8px;
}

.rest-state.inline {
  align-items: center;
  width: 100%;
  max-width: 320px;
}

.rest-state.stacked {
  flex-direction: column;
}

.rest-state-label {
  font-size: 13px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.stacked .rest-state-label {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.rest-state-row {
  display: flex;
  gap: 8px;
}

.inline .rest-state-row {
  flex: 1;
}

.rest-btn {
  flex: 1;
  height: 38px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-surface);
  transition:
    border-color 0.15s,
    color 0.15s,
    background 0.15s;
}

.stacked .rest-btn {
  height: 48px;
  max-width: 160px;
}

.rest-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}
</style>
