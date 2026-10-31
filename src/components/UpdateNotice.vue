<script setup lang="ts">
// App only: a newer release found by the opt-in update check (Settings > Updates).
import { useUpdateCheck } from '../composables/useUpdateCheck';
import { formatVersion, releaseTagUrl } from '../utils/version';

const { available, showNotice, dismiss } = useUpdateCheck();
</script>

<template>
  <Teleport to="body">
    <!-- status, not alert: news of an update must not interrupt what the user is doing. -->
    <div v-if="showNotice && available" class="update-notice" role="status">
      <span class="update-message">{{
        $t('updateNotice.available', { version: formatVersion(available) })
      }}</span>
      <div class="update-actions">
        <a
          class="btn-view"
          :href="releaseTagUrl(available)"
          target="_blank"
          rel="noopener noreferrer"
          @click="dismiss"
          >{{ $t('updateNotice.view') }}</a
        >
        <button class="btn-close" @click="dismiss">{{ $t('updateNotice.dismiss') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.update-notice {
  position: fixed;
  bottom: calc(var(--nav-offset) + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 12px 16px;
  box-shadow: var(--shadow-lg);
  z-index: 600;
  max-width: calc(100vw - 32px);
  flex-wrap: wrap;
  justify-content: center;
  text-align: center;
}

.update-message {
  font-size: 14px;
  color: var(--color-text);
}

.update-actions {
  display: flex;
  gap: 8px;
}

.btn-view {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--color-primary);
}

.btn-close {
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
