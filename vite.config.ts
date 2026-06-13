import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      workbox: {
        // Hash routing doesn't need a navigation fallback — all Vue routes live under #.
        // Without this, the SW intercepts e.g. /sitemap.xml and serves index.html instead.
        navigateFallback: null,
      },
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'CardiPaw',
        short_name: 'CardiPaw',
        description: "Free resting respiratory rate (RRR) tracker for cats and dogs with HCM or heart conditions. Count breaths, track trends, and export reports — no account needed, all data stays on your device.",
        theme_color: '#e05c7a',
        background_color: '#faf9f7',
        display: 'standalone',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
