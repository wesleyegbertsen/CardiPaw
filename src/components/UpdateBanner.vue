<script setup lang="ts">
// PWA update/offline notifications — https://vite-pwa-org.netlify.app/frameworks/vue.html
import { onUnmounted } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'

let updateTimer: ReturnType<typeof setInterval> | undefined
let unmounted = false

const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW({
  onRegistered(r) {
    // Registration can finish after the banner is gone; don't start a check nobody can stop.
    if (r && !unmounted) updateTimer = setInterval(() => r.update(), 60 * 60 * 1000)
  },
})

onUnmounted(() => {
  unmounted = true
  clearInterval(updateTimer)
})

function close() {
  offlineReady.value = false
  needRefresh.value = false
}
</script>

<template>
  <Teleport to="body">
    <div v-if="offlineReady || needRefresh" class="update-banner" role="alert">
      <span v-if="offlineReady" class="update-message">{{ $t('update.offline') }}</span>
      <span v-else class="update-message">{{ $t('update.newVersion') }}</span>
      <div class="update-actions">
        <button v-if="needRefresh" class="btn-reload" @click="updateServiceWorker()">{{ $t('update.reload') }}</button>
        <button class="btn-close" @click="close">{{ $t('common.close') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.update-banner {
  position: fixed;
  bottom: calc(var(--nav-height) + 8px);
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

.btn-reload {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--color-primary);
  border: none;
  cursor: pointer;
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
