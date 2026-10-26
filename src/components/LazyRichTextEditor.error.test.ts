import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { LazyRichTextEditor } from './LazyRichTextEditor';
import { createTestI18n } from '../test/i18n';

// Stands in for a chunk that cannot be fetched (offline after an update).
vi.mock('./RichTextEditor.vue', () => {
  throw new Error('chunk');
});

enableAutoUnmount(afterEach);

// An async component is meant to be rendered by a parent.
const host = (modelValue: string) =>
  defineComponent({ render: () => h(LazyRichTextEditor, { modelValue }) });

describe('LazyRichTextEditor when the chunk fails', () => {

  it('shows an alert instead of the editor', async () => {
    // Vue logs the loader error.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = mount(host(''), {
      global: { plugins: [createTestI18n()] },
    });
    await vi.waitFor(async () => {
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'The editor could not be loaded. Close and reopen the app to try again.',
    );
    expect(wrapper.find('div[aria-hidden="true"]').exists()).toBe(false);
  });
});
