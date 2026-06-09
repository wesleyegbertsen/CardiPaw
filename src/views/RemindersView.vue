<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePetsStore } from '../stores/pets';
import { useRemindersStore } from '../stores/reminders';
import ReminderCard from '../components/ReminderCard.vue';

const route = useRoute();
const router = useRouter();
const petsStore = usePetsStore();
const remindersStore = useRemindersStore();

const petId = route.params.id as string;
const pet = computed(() => petsStore.getPetById(petId));
const reminders = computed(() => remindersStore.getRemindersForPet(petId));

const notificationPermission = ref<NotificationPermission>('default');
const infoExpanded = ref(false);

const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent);
const isInstalledPWA = window.matchMedia('(display-mode: standalone)').matches
  || (navigator as any).standalone === true;
const notificationsSupported = 'Notification' in window;

onMounted(async () => {
  await remindersStore.loadRemindersForPet(petId);
  if (notificationsSupported) {
    notificationPermission.value = Notification.permission;
  }
});

async function requestPermission() {
  if (!notificationsSupported) return;
  const result = await Notification.requestPermission();
  notificationPermission.value = result;
}

function addReminder() {
  router.push({ name: 'reminder-add', params: { id: petId } });
}

function editReminder(reminderId: string) {
  router.push({ name: 'reminder-edit', params: { id: petId, reminderId } });
}

function goBack() {
  router.push({ name: 'pet', params: { id: petId } });
}
</script>

<template>
  <div class="view-container">
    <header class="page-header">
      <button class="icon-btn" @click="goBack" aria-label="Back">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
      <div class="header-title">
        <span class="header-main">Reminders</span>
        <span v-if="pet" class="header-sub">{{ pet.name }}</span>
      </div>
      <div class="header-spacer" aria-hidden="true" />
    </header>

    <!-- Notification permission banner -->
    <div v-if="notificationsSupported && notificationPermission === 'default'" class="permission-banner">
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" class="bell-icon">
        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
      </svg>
      <p>Allow notifications to receive reminders.</p>
      <button class="btn-primary-sm" @click="requestPermission">Allow</button>
    </div>

    <div v-if="notificationsSupported && notificationPermission === 'denied'" class="permission-banner permission-denied">
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <p>Notifications are blocked. Enable them in your browser settings.</p>
    </div>

    <!-- Reliability info card -->
    <div class="info-card">
      <button class="info-toggle" @click="infoExpanded = !infoExpanded" aria-label="Toggle notification info">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <span>How reminders work</span>
        <svg class="chevron" :class="{ open: infoExpanded }" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6-1.41-1.41z"/>
        </svg>
      </button>
      <div v-if="infoExpanded" class="info-body">
        <template v-if="isIOS">
          Reminders fire while the app is open. Background delivery is not available on iOS.
        </template>
        <template v-else-if="isInstalledPWA">
          Reminders fire reliably while the app is open. When closed, you may receive reminders within ~1 hour of the scheduled time.
        </template>
        <template v-else>
          Reminders fire while the app is open. For background reminders on Android, <strong>install CardiPaw to your Home Screen</strong> using the browser menu.
        </template>
      </div>
    </div>

    <!-- Reminder list -->
    <div class="reminder-list" v-if="reminders.length > 0">
      <ReminderCard
        v-for="reminder in reminders"
        :key="reminder.id"
        :reminder="reminder"
        @click="editReminder(reminder.id)"
        @toggle="(reminderId, petId) => remindersStore.toggleReminder(reminderId, petId)"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" class="empty-icon">
        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
      </svg>
      <p>No reminders yet</p>
      <button class="btn-primary" @click="addReminder">Add Reminder</button>
    </div>

    <!-- FAB -->
    <button v-if="reminders.length > 0" class="fab" @click="addReminder" aria-label="Add reminder">
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.view-container {
  min-height: 100%;
  padding-bottom: calc(var(--nav-height) + 80px);
  background: var(--color-bg);
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-title {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.header-main {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
}

.header-sub {
  font-size: 12px;
  color: var(--color-text-muted);
}

.header-spacer {
  width: 36px;
  flex-shrink: 0;
}

.icon-btn {
  background: none;
  border: none;
  color: var(--color-text);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

/* Permission banner */
.permission-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 16px 0;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--color-text);
}

.permission-banner.permission-denied {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
}

.permission-banner p {
  flex: 1;
  margin: 0;
  font-size: 13px;
}

.bell-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.btn-primary-sm {
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

/* Info card */
.info-card {
  margin: 12px 16px 0;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.info-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: left;
}

.info-toggle svg:first-child {
  color: var(--color-primary);
  flex-shrink: 0;
}

.info-toggle span {
  flex: 1;
}

.chevron {
  transition: transform 0.2s;
  flex-shrink: 0;
}

.chevron.open {
  transform: rotate(180deg);
}

.info-body {
  padding: 10px 14px 12px;
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.5;
  border-top: 1px solid var(--color-border);
}

/* Reminder list */
.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px 0;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 24px;
  text-align: center;
}

.empty-icon {
  color: var(--color-text-muted);
  opacity: 0.4;
}

.empty-state p {
  color: var(--color-text-muted);
  font-size: 15px;
  margin: 0;
}

.btn-primary {
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  padding: 12px 28px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

/* FAB */
.fab {
  position: fixed;
  bottom: calc(var(--nav-height) + 16px);
  right: 16px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-lg);
  z-index: 50;
}
</style>
