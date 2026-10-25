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
vi.mock('../components/LazyRichTextEditor', async () =>
  (await import('../test/stubs')).lazyEditorStubModule(),
);

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
    // Hoisted spies outlive each test, so clear their calls to keep tests order-independent.
    for (const fn of [...Object.values(audio), ...Object.values(haptics)]) fn.mockClear();
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

  it.each(['0', '12.5', '250'])('blocks saving a manual rate of %s', async (value) => {
    const { wrapper, addReading } = await mountTracker();
    await wrapper.findAll('.mode-pill')[1].trigger('click');
    await wrapper.get('.manual-rate-input').setValue(value);
    const save = wrapper.get<HTMLButtonElement>('.btn-save');
    expect(save.element.disabled).toBe(true);
    expect(wrapper.get<HTMLElement>('.manual-body .rate-badge').element.style.visibility).toBe(
      'hidden',
    );
    save.element.click();
    await flushPromises();
    expect(addReading).not.toHaveBeenCalled();
  });

  it.each(['guided', 'manual'])('reports a failed %s save and lets the user retry', async (mode) => {
    const { wrapper, addReading } = await mountTracker();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    addReading.mockRejectedValueOnce(new Error('quota exceeded'));
    if (mode === 'manual') {
      await wrapper.findAll('.mode-pill')[1].trigger('click');
      await wrapper.get('.manual-rate-input').setValue('42');
    } else {
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const push = vi.spyOn(router, 'push');

    await wrapper.get('.btn-save').trigger('click');
    await flushPromises();
    expect(push).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'The reading could not be saved. Please try again.',
    );
    expect(wrapper.get<HTMLButtonElement>('.btn-save').element.disabled).toBe(false);
    expect(error).toHaveBeenCalled();

    await wrapper.get('.btn-save').trigger('click');
    await flushPromises();
    expect(addReading).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith({ name: 'pet', params: { id: pet.id } });
    error.mockRestore();
  });

  it('names the sound and vibration switches', async () => {
    const { wrapper } = await mountTracker();
    const names = wrapper.findAll('[role="switch"]').map((s) => {
      const id = s.attributes('aria-labelledby');
      return id ? document.getElementById(id)?.textContent : undefined;
    });
    expect(names).toEqual(['Sound', 'Vibration']);
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
    wrapper.unmount();

    // A countdown still running after unmount would finish and play the done cue.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(audio.playDoneSound).not.toHaveBeenCalled();
    expect(haptics.vibrateDone).not.toHaveBeenCalled();
  });
});
