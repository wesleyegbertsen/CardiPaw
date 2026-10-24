import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Kept separate from vite.config.ts so tests don't load the PWA plugin.
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Plain Node by default: it has CompressionStream, Blob and Response built in.
    // Component tests opt in to a DOM with `// @vitest-environment happy-dom`.
    environment: 'node',
  },
});
