import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Tests run in UTC regardless of the developer's shell; tests that need another
// zone opt in with vi.stubEnv('TZ', …), which unstubEnvs undoes after each test.
process.env.TZ = 'UTC';

// Kept separate from vite.config.ts so tests don't load the PWA plugin.
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  resolve: {
    alias: {
      // The PWA plugin provides this virtual module only in vite.config.ts; tests get a stub.
      'virtual:pwa-register/vue': fileURLToPath(new URL('./src/test/pwaRegister.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Plain Node by default: it has CompressionStream, Blob and Response built in.
    // Component tests opt in to a DOM with `// @vitest-environment happy-dom`.
    environment: 'node',
    // Child processes, not worker threads: Node only applies a runtime change of
    // process.env.TZ (stubTimezone in src/test/timezone.ts) on the main thread.
    pool: 'forks',
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
