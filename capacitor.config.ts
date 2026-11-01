import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cardipaw.app', // permanent once published on Google Play
  appName: 'CardiPaw',
  // `npm run build:android` builds here (vite build --mode capacitor), never into dist/.
  webDir: 'dist-native',
  server: {
    // NEVER change these: the origin https://localhost owns every user's IndexedDB and
    // localStorage, and a different scheme or hostname starts the app with no data.
    androidScheme: 'https',
    hostname: 'localhost',
  },
  plugins: {
    // The page extends under the system bars (viewport-fit=cover, added in capacitor mode
    // by vite.config.ts) and global.css pads it with env(safe-area-inset-*).
    SystemBars: { insetsHandling: 'native', initialViewportFitValueHint: 'cover' },
    // ic_stat_cardipaw comes from scripts/generate-android-assets.mjs; the colour is
    // global.css --color-primary.
    LocalNotifications: { smallIcon: 'ic_stat_cardipaw', iconColor: '#e05c7a' },
  },
};

export default config;
