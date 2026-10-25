import { defineAsyncComponent, defineComponent, h } from 'vue';
import { useI18n } from 'vue-i18n';

// TipTap/ProseMirror (~350 KB) is only needed once a notes field is on screen, so the
// editor is loaded on demand instead of being part of the main bundle.

// Holds the editor's place while its chunk loads, so the form below doesn't jump.
// Mirrors the frame and rendered height (toolbar + minimum content area) of RichTextEditor.vue.
const RichTextEditorPlaceholder = () =>
  h('div', {
    'aria-hidden': 'true',
    style: {
      minHeight: '133px',
      border: '1.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface)',
    },
  });

const RichTextEditorLoadError = defineComponent({
  // Receives the load error plus the editor's own props/listeners (v-model); none of them
  // belong on the message element.
  inheritAttrs: false,
  setup() {
    const { t } = useI18n();
    return () =>
      h(
        'p',
        {
          role: 'alert',
          style: {
            margin: 0,
            padding: '10px 14px',
            fontSize: '13px',
            color: 'var(--color-danger-text)',
            background: 'var(--color-danger-bg)',
            borderRadius: 'var(--radius-sm)',
          },
        },
        t('editor.loadError'),
      );
  },
});

const loadRichTextEditor = () => import('./RichTextEditor.vue');

/** Starts fetching the editor chunk ahead of time, e.g. while a measurement is running. */
export function preloadRichTextEditor(): void {
  loadRichTextEditor().catch(() => {
    // Ignored here; the component shows the error if it still can't load when mounted.
  });
}

// No automatic reload when loading fails: the user may be halfway through a form (e.g. a
// finished measurement), so show a message and keep the rest of the page working. Browsers
// remember a failed module import until the page reloads, hence the message asks for that.
export const LazyRichTextEditor = defineAsyncComponent({
  loader: loadRichTextEditor,
  loadingComponent: RichTextEditorPlaceholder,
  errorComponent: RichTextEditorLoadError,
  delay: 0,
});
