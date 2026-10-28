<script setup lang="ts">
import { ref, useId } from 'vue';
import { useModal } from '../composables/useModal';

defineProps<{ message: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const id = useId();
const dialogRef = ref<HTMLElement | null>(null);
const cancelRef = ref<HTMLButtonElement | null>(null);

// Start on Cancel so a stray Enter can't confirm a destructive action
useModal(dialogRef, { onClose: () => emit('cancel'), initialFocus: cancelRef });
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('cancel')">
      <div
        ref="dialogRef"
        class="dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="`${id}-title`"
        :aria-describedby="`${id}-message`"
        tabindex="-1"
      >
        <h2 :id="`${id}-title`" class="sr-only">{{ $t('common.confirm') }}</h2>
        <p :id="`${id}-message`" class="message">{{ message }}</p>
        <div class="actions">
          <button ref="cancelRef" class="btn-cancel" @click="$emit('cancel')">{{ $t('common.cancel') }}</button>
          <button class="btn-confirm" @click="$emit('confirm')">{{ $t('common.confirm') }}</button>
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
  padding: 28px 24px;
  max-width: 340px;
  width: 100%;
  box-shadow: var(--shadow-lg);
  outline: none;
}

.message {
  font-size: 15px;
  line-height: 1.5;
  color: var(--color-text);
  margin-bottom: 24px;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn-cancel {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
}

.btn-confirm {
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: var(--color-danger);
}
</style>
