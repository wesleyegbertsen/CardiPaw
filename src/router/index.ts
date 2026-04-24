import { createRouter, createWebHashHistory } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import AddEditPetView from '../views/AddEditPetView.vue';
import PetDetailView from '../views/PetDetailView.vue';
import TrackerView from '../views/TrackerView.vue';
import SettingsView from '../views/SettingsView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/pets/add', name: 'pet-add', component: AddEditPetView },
    { path: '/pets/:id', name: 'pet', component: PetDetailView },
    { path: '/pets/:id/edit', name: 'pet-edit', component: AddEditPetView },
    { path: '/pets/:id/track', name: 'tracker', component: TrackerView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
});
