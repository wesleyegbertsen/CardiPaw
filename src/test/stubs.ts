import { vi } from 'vitest';
import { defineComponent, h, onMounted, onUnmounted } from 'vue';

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
      props: {
        modelValue: { type: String, default: '' },
        label: { type: String, default: undefined },
        labelledby: { type: String, default: undefined },
      },
      emits: ['update:modelValue'],
      setup(props, { emit }) {
        return () =>
          h('textarea', {
            class: 'notes-stub',
            value: props.modelValue,
            'aria-label': props.label,
            'aria-labelledby': props.labelledby,
            onInput: (e: Event) =>
              emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
          });
      },
    }),
  };
}

/**
 * What the CameraCapture stub emits on `.stub-result`; a test sets it before clicking. `mounts`
 * and `unmounts` count the stub's lifecycle (unmounting the real one stops the camera).
 */
export const cameraStub = {
  nextResult: { rate: 24, seconds: 30 as 30 | 60, interval: [23, 25] as [number, number], taps: null as number | null },
  mounts: 0,
  unmounts: 0,
};

/**
 * Module factory for `../components/CameraCapture.vue`, which TrackerView loads lazily: the
 * camera is covered by the component's own tests, and here buttons stand in for its outcomes.
 *
 *   vi.mock('../components/CameraCapture.vue', async () =>
 *     (await import('../test/stubs')).cameraCaptureStubModule());
 */
export function cameraCaptureStubModule() {
  return {
    // defineAsyncComponent unwraps `.default` only from an ES module; without this flag Vue
    // would treat the mock's namespace as the component and trip Vitest's strict mock proxy.
    __esModule: true,
    default: defineComponent({
      name: 'CameraCaptureStub',
      props: {
        pet: { type: Object, required: true },
        autoOpen: { type: Boolean, default: false },
      },
      emits: ['result', 'tapInstead', 'busy', 'capturing'],
      setup(props, { emit }) {
        onMounted(() => cameraStub.mounts++);
        onUnmounted(() => cameraStub.unmounts++);
        // Placing, then capturing; idle stands for every other phase (explain, an error, an abstain).
        const busy = () => emit('busy', true);
        const capturing = () => {
          emit('busy', true);
          emit('capturing', true);
        };
        const idle = () => {
          emit('busy', false);
          emit('capturing', false);
        };
        return () =>
          h('div', { class: 'camera-stub', 'data-auto-open': String(props.autoOpen) }, [
            h('button', { class: 'stub-result', onClick: () => emit('result', { ...cameraStub.nextResult }) }),
            h('button', { class: 'stub-tap-instead', onClick: () => emit('tapInstead') }),
            h('button', { class: 'stub-busy', onClick: busy }),
            h('button', { class: 'stub-capturing', onClick: capturing }),
            h('button', { class: 'stub-idle', onClick: idle }),
          ]);
      },
    }),
  };
}

/**
 * Module factory for `vue-chartjs`: a `Line` that renders a bare canvas and keeps its
 * props, so tests can read what would be drawn without Chart.js needing a canvas:
 *
 *   vi.mock('vue-chartjs', async () => (await import('../test/stubs')).recordingLineStub());
 *   wrapper.findComponent({ name: 'LineChartStub' }).props('data')
 */
export function recordingLineStub() {
  return {
    Line: defineComponent({
      name: 'LineChartStub',
      props: {
        data: { type: Object, required: true },
        options: { type: Object, default: () => ({}) },
      },
      setup: () => () => h('canvas'),
    }),
  };
}
