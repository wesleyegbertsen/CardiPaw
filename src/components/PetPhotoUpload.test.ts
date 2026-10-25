// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import PetPhotoUpload from './PetPhotoUpload.vue';
import { createTestI18n } from '../test/i18n';

enableAutoUnmount(afterEach);

// happy-dom cannot decode images or draw on a canvas, so fake the browser pieces.
const image = { width: 0, height: 0, decodes: true };

class FakeImage {
  width = 0;
  height = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) {
    queueMicrotask(() => {
      if (!image.decodes) return this.onerror?.();
      this.width = image.width;
      this.height = image.height;
      this.onload?.();
    });
  }
}

class FakeFileReader {
  onload: ((e: { target: { result: string } }) => void) | null = null;
  readAsDataURL() {
    queueMicrotask(() => this.onload?.({ target: { result: 'data:image/png;base64,AAAA' } }));
  }
}

const drawImage = vi.fn();
let canvasSize: number[] = [];

function mountUpload(modelValue: string | null = null) {
  return mount(PetPhotoUpload, {
    props: { modelValue },
    global: { plugins: [createTestI18n()] },
  });
}

async function pickFile(wrapper: ReturnType<typeof mountUpload>) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', {
    value: [new File(['x'], 'cat.png', { type: 'image/png' })],
  });
  await input.trigger('change');
  await flushPromises();
}

describe('PetPhotoUpload', () => {
  beforeEach(() => {
    Object.assign(image, { width: 0, height: 0, decodes: true });
    drawImage.mockClear();
    canvasSize = [];
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('FileReader', FakeFileReader);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      canvasSize = [this.width, this.height];
      return { drawImage } as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext']);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;resized');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scales a large photo down to fit 400 px and emits a JPEG', async () => {
    Object.assign(image, { width: 800, height: 400 });
    const wrapper = mountUpload();
    await pickFile(wrapper);
    expect(canvasSize).toEqual([400, 200]);
    expect(drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 400, 200);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
    expect(wrapper.emitted('update:modelValue')).toEqual([['data:image/jpeg;resized']]);
  });

  it('never scales a small photo up', async () => {
    Object.assign(image, { width: 120, height: 90 });
    const wrapper = mountUpload();
    await pickFile(wrapper);
    expect(canvasSize).toEqual([120, 90]);
  });

  it('emits nothing for an image the browser cannot decode', async () => {
    image.decodes = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = mountUpload();
    await pickFile(wrapper);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Photo rejected', expect.any(Error));
  });

  it('emits null when the photo is removed', async () => {
    const wrapper = mountUpload('data:image/jpeg;old');
    expect(wrapper.get('.preview-img').attributes('src')).toBe('data:image/jpeg;old');
    await wrapper.get('.remove-btn').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });
});
