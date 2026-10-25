import { vi } from 'vitest';
import { defineComponent, h } from 'vue';

/**
 * Module factory for `../components/LazyRichTextEditor`. TipTap is slow to boot in
 * tests, and a textarea is enough to check that notes reach the save. `vi.mock`
 * factories cannot see top-level imports, so load it inside the factory:
 *
 *   vi.mock('../components/LazyRichTextEditor', async () =>
 *     (await import('../test/stubs')).lazyEditorStubModule());
 */
export function lazyEditorStubModule() {
  return {
    preloadRichTextEditor: vi.fn(),
    LazyRichTextEditor: defineComponent({
      props: { modelValue: { type: String, default: '' } },
      emits: ['update:modelValue'],
      setup(props, { emit }) {
        return () =>
          h('textarea', {
            class: 'notes-stub',
            value: props.modelValue,
            onInput: (e: Event) =>
              emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
          });
      },
    }),
  };
}
