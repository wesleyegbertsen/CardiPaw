// Loaded before every test file in the dom project (setupFiles in vitest.config.ts).
import { afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

// Unmounts every wrapper from mount() (and so mountView) after each test, so teleported
// dialogs, attachTo: document.body and useModal's module-level stack of open dialogs
// never leak into the next test. VTU throws if this is called twice: test files must
// not call it themselves. Wrappers mounted in beforeAll are unmounted after the first test.
enableAutoUnmount(afterEach);
