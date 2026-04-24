<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();

const fileInput = ref<HTMLInputElement | null>(null);

function triggerInput() {
  fileInput.value?.click();
}

function removePhoto() {
  emit('update:modelValue', null);
  if (fileInput.value) fileInput.value.value = '';
}

async function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target?.result as string;
    const resized = await resizeImage(dataUrl);
    emit('update:modelValue', resized);
  };
  reader.readAsDataURL(file);
}

function resizeImage(dataUrl: string, maxSize = 400): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
  });
}
</script>

<template>
  <div class="photo-upload">
    <input ref="fileInput" type="file" accept="image/*" class="hidden-input" @change="onFileChange" />

    <div v-if="props.modelValue" class="preview-wrap">
      <img :src="props.modelValue" alt="Pet photo" class="preview-img" />
      <button type="button" class="remove-btn" @click="removePhoto" aria-label="Remove photo">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>

    <button v-else type="button" class="upload-btn" @click="triggerInput">
      <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28" class="upload-icon">
        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
      </svg>
      <span>Add photo</span>
    </button>
  </div>
</template>

<style scoped>
.hidden-input {
  display: none;
}

.upload-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 110px;
  height: 110px;
  border-radius: var(--radius-md);
  border: 2px dashed var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
  transition: border-color 0.15s, color 0.15s;
}

.upload-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.upload-icon {
  opacity: 0.5;
}

.preview-wrap {
  position: relative;
  width: 110px;
  height: 110px;
}

.preview-img {
  width: 110px;
  height: 110px;
  object-fit: cover;
  border-radius: var(--radius-md);
}

.remove-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-sm);
}
</style>
