<script setup lang="ts">
import { ref, useId } from 'vue';
import { useModal } from '../composables/useModal';

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();

const titleId = useId();
const dialogRef = ref<HTMLElement | null>(null);
useModal(dialogRef, { onClose: () => emit('close') });
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('close')">
      <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
        <div class="dialog-header">
          <h2 :id="titleId" class="dialog-title">{{ title }}</h2>
          <button class="btn-close" @click="$emit('close')" :aria-label="$t('common.close')">✕</button>
        </div>
        <div class="dialog-body">
          <slot />
        </div>
        <div class="dialog-footer">
          <button class="btn-ok" @click="$emit('close')">{{ $t('common.close') }}</button>
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
  z-index: 500;
  padding: 24px;
}

.dialog {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  max-width: 480px;
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  outline: none;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.dialog-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text);
}

.btn-close {
  font-size: 16px;
  color: var(--color-text-muted);
  background: none;
  border: none;
  padding: 4px 8px;
  line-height: 1;
  cursor: pointer;
}

.dialog-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  font-size: 14px;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.dialog-body :deep(p) {
  margin-bottom: 12px;
}

.dialog-body :deep(p:last-child) {
  margin-bottom: 0;
}

.dialog-body :deep(ul) {
  padding-left: 20px;
  margin-bottom: 12px;
}

.dialog-body :deep(li) {
  margin-bottom: 6px;
}

.dialog-body :deep(strong) {
  color: var(--color-text);
  font-weight: 600;
}

.dialog-footer {
  padding: 16px 24px 20px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.btn-ok {
  padding: 10px 24px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: var(--color-primary);
  border: none;
}
</style>
