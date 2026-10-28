import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { LazyRichTextEditor } from './LazyRichTextEditor';
import { createTestI18n } from '../test/i18n';

// The loader is cached per module, so the failure case lives in LazyRichTextEditor.error.test.ts.
vi.mock('./RichTextEditor.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    // Vue unwraps the module only when it looks like an ES module.
    __esModule: true,
    default: defineComponent({
      props: { modelValue: { type: String, default: '' } },
      setup: (props) => () => h('div', { class: 'editor-stub' }, props.modelValue),
    }),
  };
});

// An async component is meant to be rendered by a parent.
const host = (modelValue: string) =>
  defineComponent({ render: () => h(LazyRichTextEditor, { modelValue }) });

describe('LazyRichTextEditor', () => {
  it('holds the editor’s place while it loads, then shows it', async () => {
    const wrapper = mount(host('<p>Calm</p>'), {
      global: { plugins: [createTestI18n()] },
    });
    expect(wrapper.find('div[aria-hidden="true"]').exists()).toBe(true);
    expect(wrapper.find('.editor-stub').exists()).toBe(false);

    await vi.waitFor(async () => {
      await flushPromises();
      expect(wrapper.find('.editor-stub').exists()).toBe(true);
    });
    expect(wrapper.get('.editor-stub').text()).toBe('<p>Calm</p>');
    expect(wrapper.find('div[aria-hidden="true"]').exists()).toBe(false);
  });
});
