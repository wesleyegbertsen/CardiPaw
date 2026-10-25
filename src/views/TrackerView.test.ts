// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import TrackerView from './TrackerView.vue';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { createTestI18n } from '../test/i18n';
import { makePet, makeReading } from '../test/fixtures';

const audio = vi.hoisted(() => ({ init: vi.fn(), playBeep: vi.fn(), playDoneSound: vi.fn() }));
const haptics = vi.hoisted(() => ({ vibrateTap: vi.fn(), vibrateDone: vi.fn() }));

vi.mock('../composables/useAudioBeep', () => ({ useAudioBeep: () => audio }));
vi.mock('../composables/useHaptics', () => ({
  useHaptics: () => ({ isSupported: true, ...haptics }),
}));
vi.mock('../composables/useOnboarding', async () => {
  const { ref } = await import('vue');
  return { useOnboarding: () => ({ hasSeenOnboarding: ref(true), markSeen: vi.fn() }) };
});
// TipTap needs a real layout engine; a textarea is enough to check the notes reach the save.
vi.mock('../components/LazyRichTextEditor', async () => {
  const { defineComponent, h } = await import('vue');
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
});

enableAutoUnmount(afterEach);

const Blank = defineComponent({ render: () => h('div') });
const pet = makePet();
let router: Router;

async function mountTracker() {
  const pinia = createPinia();
  setActivePinia(pinia);
  usePetsStore().pets = [pet];
  const addReading = vi
    .spyOn(useReadingsStore(), 'addReading')
    .mockImplementation(async (data) => makeReading(data));

  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/pet/:id', name: 'pet', component: Blank },
      { path: '/pet/:id/track', name: 'track', component: Blank },
    ],
  });
  await router.push({ name: 'track', params: { id: pet.id } });
  await router.isReady();

  const wrapper = mount(TrackerView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createTestI18n()] },
  });
  return { wrapper, addReading };
}

describe('TrackerView', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts taps for 30 seconds and shows breaths per minute', async () => {
    const { wrapper } = await mountTracker();
    const heart = wrapper.get('.heart-btn');
    await heart.trigger('click');
    await heart.trigger('click');
    await heart.trigger('click');
    expect(wrapper.get('.count-number').text()).toBe('3');

    await vi.advanceTimersByTimeAsync(29_000);
    expect(wrapper.find('.result-number').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(wrapper.get('.result-number').text()).toBe('6');
    expect(audio.playDoneSound).toHaveBeenCalledOnce();
    expect(haptics.vibrateDone).toHaveBeenCalledOnce();
  });

  it('saves a guided measurement and returns to the pet', async () => {
    const { wrapper, addReading } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    await wrapper.get('.heart-btn').trigger('click');
    await vi.advanceTimersByTimeAsync(30_000);

    await wrapper.findAll('.rest-btn')[1].trigger('click');
    await wrapper.get('.notes-stub').setValue('<p>calm</p>');
    await wrapper.get('.btn-save').trigger('click');
    await flushPromises();

    expect(addReading).toHaveBeenCalledWith({
      petId: pet.id,
      date: '2024-03-15T12:00:30.000Z',
      rate: 4,
      clickCount: 2,
      restState: 'sleeping',
      notes: '<p>calm</p>',
      source: undefined,
    });
    expect(router.currentRoute.value.name).toBe('pet');
  });

  it('saves a manual entry', async () => {
    const { wrapper, addReading } = await mountTracker();
    await wrapper.findAll('.mode-pill')[1].trigger('click');
    expect(wrapper.get('.btn-save').attributes('disabled')).toBeDefined();

    await wrapper.get('.manual-rate-input').setValue('42');
    await wrapper.findAll('.rest-btn')[0].trigger('click');
    await wrapper.get('.btn-save').trigger('click');
    await flushPromises();

    expect(addReading).toHaveBeenCalledWith({
      petId: pet.id,
      date: '2024-03-15T12:00:00.000Z',
      rate: 42,
      clickCount: 0,
      restState: 'resting',
      notes: undefined,
      source: 'manual',
    });
    expect(router.currentRoute.value.name).toBe('pet');
  });

  it('saves only once when Save is clicked twice in a row', async () => {
    const { wrapper, addReading } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    await vi.advanceTimersByTimeAsync(30_000);

    const save = wrapper.get('.btn-save').element as HTMLButtonElement;
    save.click();
    save.click();
    await flushPromises();

    expect(addReading).toHaveBeenCalledOnce();
  });

  it('resets the timer and count on Try again', async () => {
    const { wrapper } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    await vi.advanceTimersByTimeAsync(30_000);

    await wrapper.get('.btn-retry').trigger('click');
    expect(wrapper.find('.tap-hint').exists()).toBe(true);

    await wrapper.get('.heart-btn').trigger('click');
    expect(wrapper.get('.timer-number').text()).toBe('30');
    expect(wrapper.get('.count-number').text()).toBe('1');
  });

  it('stops the countdown when leaving mid-measurement', async () => {
    const { wrapper } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    // Let the tap pulse animation finish so only the countdown is left.
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(1);

    wrapper.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
