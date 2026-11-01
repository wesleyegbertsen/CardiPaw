import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { router } from './router';
import { i18n } from './i18n';
import App from './App.vue';
import { installBackButton } from './native/backButton';
import { cleanUpOldExports } from './native/exportCleanup';
import { installUpdateCheck } from './native/updateCheck';
import './assets/styles/global.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
installBackButton(router);
cleanUpOldExports();
installUpdateCheck();
app.use(i18n);
app.mount('#app');
