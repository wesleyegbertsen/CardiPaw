<script setup lang="ts">
// App only: the last automatic backup failed (Settings > Automatic backups shows why).
import { useRouter } from 'vue-router';
import { useAutoBackup } from '../composables/useAutoBackup';

const { showNotice, dismissNotice } = useAutoBackup();
const router = useRouter();
</script>

<template>
  <Teleport to="body">
    <!-- status, not alert: a failed backup must not interrupt what the user is doing. -->
    <div v-if="showNotice" class="backup-notice" role="status">
      <span class="backup-message">{{ $t('backupNotice.failed') }}</span>
      <div class="backup-actions">
        <!-- Doesn't dismiss: the notice goes once Settings has fixed the backup. -->
        <button class="btn-view" @click="router.push({ name: 'settings' })">
          {{ $t('backupNotice.open') }}
        </button>
        <button class="btn-close" @click="dismissNotice">{{ $t('backupNotice.dismiss') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * In UpdateNotice's spot, which App.vue hides while this shows. Above the add button (the FAB
 * sits at nav-offset + 20px and is 56px tall, plus a 12px gap) and above the nav (z-index
 * 100), but under the modal overlays (500): an open dialog's backdrop dims the notice and
 * catches taps on it.
 */
.backup-notice {
  position: fixed;
  bottom: calc(var(--nav-offset) + 88px);
  /* Both sides pinned and auto margins centre it: with left: 50% the box could only grow
     into half the screen, so the buttons wrapped. */
  left: 16px;
  right: 16px;
  width: fit-content;
  margin-inline: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 12px 16px;
  box-shadow: var(--shadow-lg);
  z-index: 450;
  max-width: calc(100vw - 32px);
  flex-wrap: wrap;
  justify-content: center;
  text-align: center;
}

.backup-message {
  font-size: 14px;
  color: var(--color-text);
}

.backup-actions {
  display: flex;
  gap: 8px;
}

.btn-view {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--color-primary);
}

.btn-close {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  cursor: pointer;
}
</style>
