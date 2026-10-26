// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import type { Editor } from '@tiptap/vue-3';
import RichTextEditor from './RichTextEditor.vue';
import en from '../i18n/locales/en.json';
import nl from '../i18n/locales/nl.json';

enableAutoUnmount(afterEach);

// Real TipTap: it runs in happy-dom, and TipTap core puts the Editor on its DOM node.
function mountEditor(modelValue = '', props: { label?: string; labelledby?: string } = {}) {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, nl },
  });
  const wrapper = mount(RichTextEditor, {
    props: { modelValue, ...props },
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  const editor = () =>
    (wrapper.get('.ProseMirror').element as HTMLElement & { editor: Editor }).editor;
  return { wrapper, i18n, editor };
}

const placeholderText = (wrapper: ReturnType<typeof mountEditor>['wrapper']) =>
  wrapper.get('.ProseMirror p').attributes('data-placeholder');

describe('RichTextEditor', () => {
  it('emits an empty string when the content is cleared', async () => {
    const { wrapper, editor } = mountEditor('<p>Calm</p>');
    await flushPromises();
    editor().commands.clearContent(true);
    expect(wrapper.emitted('update:modelValue')).toEqual([['']]);
  });

  it('emits the HTML of what was typed', async () => {
    const { wrapper, editor } = mountEditor();
    await flushPromises();
    editor().commands.insertContent('Calm');
    expect(wrapper.emitted('update:modelValue')).toEqual([['<p>Calm</p>']]);
  });

  it('shows the placeholder in the current language', async () => {
    const { wrapper, i18n } = mountEditor();
    await flushPromises();
    expect(placeholderText(wrapper)).toBe('Add notes… (optional)');

    i18n.global.locale.value = 'nl';
    await flushPromises();
    expect(placeholderText(wrapper)).toBe('Notities toevoegen… (optioneel)');
  });

  it('marks Bold as active once applied', async () => {
    const { wrapper, editor } = mountEditor('<p>Calm</p>');
    await flushPromises();
    editor().commands.selectAll();
    const bold = wrapper.get('[aria-label="Bold"]');
    expect(bold.classes()).not.toContain('active');

    await bold.trigger('click');
    // The Vue binding re-renders two animation frames after a transaction.
    await vi.waitFor(() => expect(bold.classes()).toContain('active'));
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['<p><strong>Calm</strong></p>']);
  });

  it('is a named multiline textbox', async () => {
    const { wrapper } = mountEditor('', { label: 'Notes' });
    await flushPromises();
    const content = wrapper.get('.ProseMirror');
    expect(content.classes()).toContain('rich-editor-content');
    expect(content.attributes('role')).toBe('textbox');
    expect(content.attributes('aria-multiline')).toBe('true');
    expect(content.attributes('aria-label')).toBe('Notes');
    expect(content.attributes('aria-labelledby')).toBeUndefined();

    await wrapper.setProps({ label: 'Notizen' });
    await flushPromises();
    expect(content.attributes('aria-label')).toBe('Notizen');
  });

  it('prefers a visible label over its own', async () => {
    const { wrapper } = mountEditor('', { label: 'Notes', labelledby: 'notes-label' });
    await flushPromises();
    const content = wrapper.get('.ProseMirror');
    expect(content.attributes('aria-labelledby')).toBe('notes-label');
    expect(content.attributes('aria-label')).toBeUndefined();
  });

  it('exposes the toolbar state with aria-pressed', async () => {
    const { wrapper, editor } = mountEditor('<p>Calm</p>');
    await flushPromises();
    const pressed = () => wrapper.findAll('.toolbar-btn').map((b) => b.attributes('aria-pressed'));
    expect(pressed()).toEqual(['false', 'false', 'false']);
    editor().chain().selectAll().toggleBold().run();
    await vi.waitFor(() => expect(pressed()).toEqual(['true', 'false', 'false']));
  });
});
