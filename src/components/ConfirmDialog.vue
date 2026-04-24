<script setup lang="ts">
defineProps<{ message: string }>();
defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="$emit('cancel')">
      <div class="dialog" role="alertdialog" aria-modal="true">
        <p class="message">{{ message }}</p>
        <div class="actions">
          <button class="btn-cancel" @click="$emit('cancel')">Cancel</button>
          <button class="btn-confirm" @click="$emit('confirm')">Confirm</button>
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
