<script setup lang="ts">
/** An on/off switch; the caller renders the visible label and passes its id. */
const on = defineModel<boolean>({ required: true });
defineProps<{ labelledby: string; disabled?: boolean }>();
</script>

<template>
  <button
    class="slide-toggle"
    :class="{ on }"
    role="switch"
    :aria-checked="on"
    :aria-labelledby="labelledby"
    :disabled="disabled"
    @click="on = !on"
  />
</template>

<style scoped>
.slide-toggle {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: var(--radius-full);
  background: var(--color-bg);
  border: 1.5px solid var(--color-border);
  transition:
    background 0.18s,
    border-color 0.18s;
  flex-shrink: 0;
  cursor: pointer;
}

.slide-toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-text-muted);
  transition:
    transform 0.18s,
    background 0.18s;
  box-shadow: var(--shadow-sm);
}

.slide-toggle.on {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.slide-toggle.on::after {
  transform: translateX(18px);
  background: #fff;
}

.slide-toggle:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
