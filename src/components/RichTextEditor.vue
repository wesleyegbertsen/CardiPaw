<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      strike: false,
    }),
    Placeholder.configure({
      placeholder: props.placeholder ?? 'Add notes… (optional)',
    }),
  ],
  content: props.modelValue,
  editorProps: {
    attributes: {
      class: 'rich-editor-content',
    },
  },
  onUpdate({ editor }) {
    const html = editor.getHTML();
    emit('update:modelValue', html === '<p></p>' ? '' : html);
  },
});

watch(
  () => props.modelValue,
  (newVal) => {
    if (!editor.value) return;
    const current = editor.value.getHTML();
    const normalized = current === '<p></p>' ? '' : current;
    if (newVal !== normalized) {
      editor.value.commands.setContent(newVal || '', false);
    }
  }
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<template>
  <div class="rich-editor-wrapper" :class="{ focused: editor?.isFocused }">
    <div v-if="editor" class="rich-editor-toolbar">
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor.isActive('bold') }"
        @click="editor.chain().focus().toggleBold().run()"
        aria-label="Bold"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>
        </svg>
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor.isActive('italic') }"
        @click="editor.chain().focus().toggleItalic().run()"
        aria-label="Italic"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/>
        </svg>
      </button>
      <div class="toolbar-divider" />
      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: editor.isActive('bulletList') }"
        @click="editor.chain().focus().toggleBulletList().run()"
        aria-label="Bullet list"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>
        </svg>
      </button>
    </div>

    <EditorContent :editor="editor" />
  </div>
</template>

<style scoped>
.rich-editor-wrapper {
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  transition: border-color 0.15s;
  overflow: hidden;
}

.rich-editor-wrapper.focused {
  border-color: var(--color-primary);
}

.rich-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: none;
  transition: background 0.12s, color 0.12s;
}

.toolbar-btn:hover {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary);
}

.toolbar-btn.active {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--color-border);
  margin: 0 4px;
}

.rich-editor-wrapper :deep(.ProseMirror) {
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  color: var(--color-text);
  line-height: 1.5;
  min-height: 88px;
  outline: none;
}

.rich-editor-wrapper :deep(.ProseMirror ul) {
  padding-left: 20px;
}

.rich-editor-wrapper :deep(.ProseMirror li) {
  margin-bottom: 2px;
}

.rich-editor-wrapper :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--color-text-muted);
  pointer-events: none;
  float: left;
  height: 0;
}
</style>
