// Loaded before every test file (setupFiles in vitest.config.ts). Files run isolated,
// so each one gets its own in-memory IndexedDB.
import 'fake-indexeddb/auto';
