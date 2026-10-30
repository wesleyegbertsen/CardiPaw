import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
// The release pipeline stamps the version into package.json (scripts/set-version.mjs) before building.
import { version } from './package.json'

// `vite build --mode capacitor` (npm run build:android) builds the Android app into
// dist-native/: no service worker or web manifest, and the page extends under the system bars.
export default defineConfig(({ mode }) => {
  const native = mode === 'capacitor'
  return {
    build: { outDir: native ? 'dist-native' : 'dist' },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      // vue-i18n 10+ always compiles messages to an AST and interprets it, never with
      // `new Function`, so the Content-Security-Policy in nginx.conf (no 'unsafe-eval') holds.
    },
    plugins: [
      vue(),
      native && nativeIndexHtml(),
      VitePWA({
        // The app ships its files in the APK; a service worker would only serve stale ones after an update.
        disable: native,
        registerType: 'prompt',
        workbox: {
          // Hash routing doesn't need a navigation fallback — all Vue routes live under #.
          // Without this, the SW intercepts e.g. /sitemap.xml and serves index.html instead.
          navigateFallback: null,
          runtimeCaching: [
            {
              // Cache Japanese fonts on first use (only fetched when locale is ja + PDF is generated).
              // CacheFirst means subsequent requests — including offline — are served from cache.
              urlPattern: /\/fonts\/.*\.ttf$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'pdf-fonts',
                expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
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
  }
})

const VIEWPORT = 'width=device-width, initial-scale=1.0'

/** Lets the page draw under the status and navigation bars; global.css pads it with env(safe-area-inset-*). */
function nativeIndexHtml(): Plugin {
  return {
    name: 'cardipaw-native-index-html',
    transformIndexHtml(html) {
      if (!html.includes(`content="${VIEWPORT}"`)) {
        throw new Error('index.html viewport meta changed: update nativeIndexHtml in vite.config.ts')
      }
      return html.replace(`content="${VIEWPORT}"`, `content="${VIEWPORT}, viewport-fit=cover"`)
    },
  }
}
