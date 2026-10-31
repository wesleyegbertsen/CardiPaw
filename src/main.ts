import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { router } from './router';
import { i18n } from './i18n';
import App from './App.vue';
import { installBackButton } from './native/backButton';
import './assets/styles/global.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
installBackButton(router);
app.use(i18n);
app.mount('#app');
