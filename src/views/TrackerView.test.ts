// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import TrackerView from './TrackerView.vue';
import { routes } from '../router';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { deferred } from '../test/deferred';
import { createTestI18n } from '../test/i18n';
import { Blank } from '../test/mountView';
import { makePet, makeReading } from '../test/fixtures';
import * as db from '../services/db';
import type { Pet, Reading } from '../types';

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

const pet = makePet();
let router: Router;

/**
 * `stored` set: the pets store starts empty, as on a reload straight into the tracker, and
 * loading pets resolves with `stored` (or rejects, for an Error; or settles with a Promise).
 */
async function mountTracker({ stored }: { stored?: Pet[] | Error | Promise<Pet[]> } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const getAllPets = vi.spyOn(db, 'getAllPets');
  if (stored === undefined) usePetsStore().pets = [pet];
  else if (stored instanceof Error) getAllPets.mockRejectedValueOnce(stored);
  else if (stored instanceof Promise) getAllPets.mockReturnValueOnce(stored);
  else getAllPets.mockResolvedValueOnce(stored);
  const addReading = vi
    .spyOn(useReadingsStore(), 'addReading')
    .mockImplementation(async (data) => makeReading(data));

  // The app's real routes (as mountView uses), so a renamed route fails here too.
  router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((r) => ({ ...r, component: Blank })),
  });
  await router.push({ name: 'tracker', params: { id: pet.id } });
  await router.isReady();

  const push = vi.spyOn(router, 'push');
  const replace = vi.spyOn(router, 'replace');

  const wrapper = mount(TrackerView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createTestI18n()] },
  });
  await flushPromises();
  return { wrapper, addReading, getAllPets, push, replace };
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

    // The old alert goes away as soon as the retry starts.
    const retry = deferred<Reading>();
    addReading.mockImplementationOnce(() => retry.promise);
    await wrapper.get('.btn-save').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    retry.resolve(makeReading());
    await flushPromises();
    expect(addReading).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith({ name: 'pet', params: { id: pet.id } });
  });

  describe('after a failed save', () => {
    async function failSave(wrapper: VueWrapper, addReading: MockInstance) {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      addReading.mockRejectedValueOnce(new Error('quota exceeded'));
      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    }

    it('drops the error on Try again, also for the next result', async () => {
      const { wrapper, addReading } = await mountTracker();
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(30_000);
      await failSave(wrapper, addReading);

      await wrapper.get('.btn-retry').trigger('click');
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(wrapper.find('.result-number').exists()).toBe(true);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('drops the error when switching modes', async () => {
      const { wrapper, addReading } = await mountTracker();
      const [guided, manual] = wrapper.findAll('.mode-pill');
      await manual.trigger('click');
      await wrapper.get('.manual-rate-input').setValue('42');
      await failSave(wrapper, addReading);

      await guided.trigger('click');
      await manual.trigger('click');
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('drops the error on Discard', async () => {
      const { wrapper, addReading } = await mountTracker();
      await wrapper.findAll('.mode-pill')[1].trigger('click');
      await wrapper.get('.manual-rate-input').setValue('42');
      await failSave(wrapper, addReading);

      await wrapper.get('.btn-discard').trigger('click');
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });
  });

  it('keeps the entry when the active mode is clicked again', async () => {
    const { wrapper } = await mountTracker();
    const manual = wrapper.findAll('.mode-pill')[1];
    await manual.trigger('click');
    await wrapper.get('.manual-rate-input').setValue('42');
    await wrapper.findAll('.rest-btn')[0].trigger('click');
    await wrapper.get('.notes-stub').setValue('<p>calm</p>');

    await manual.trigger('click');
    expect(wrapper.get<HTMLInputElement>('.manual-rate-input').element.value).toBe('42');
    expect(wrapper.find('.rest-btn.active').exists()).toBe(true);
    expect(wrapper.get<HTMLTextAreaElement>('.notes-stub').element.value).toBe('<p>calm</p>');
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

  describe('opened directly (pets not loaded yet)', () => {
    it('loads the pet itself and saves for it', async () => {
      const { wrapper, addReading } = await mountTracker({ stored: [pet] });
      expect(wrapper.get('.pet-name-label').text()).toBe(pet.name);
      await wrapper.findAll('.mode-pill')[1].trigger('click');
      await wrapper.get('.manual-rate-input').setValue('42');
      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledWith(expect.objectContaining({ petId: pet.id, rate: 42 }));
    });

    it('shows a loading status instead of an empty body until the pet has loaded', async () => {
      const load = deferred<Pet[]>();
      const { wrapper } = await mountTracker({ stored: load.promise });
      expect(wrapper.get('[role="status"]').text()).toBe('Loading…');
      expect(wrapper.find('.heart-btn').exists()).toBe(false);

      load.resolve([pet]);
      await flushPromises();
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
      expect(wrapper.find('.heart-btn').exists()).toBe(true);
    });

    it('shows a load error with a way back instead of the tracker when loading fails', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('blocked');
      const { wrapper, push } = await mountTracker({ stored: failure });
      expect(wrapper.get('[role="alert"]').text()).toBe(
        'This could not be loaded. Go back and try again. Your data has not been deleted.',
      );
      expect(wrapper.find('.heart-btn').exists()).toBe(false);
      expect(wrapper.find('.mode-pill').exists()).toBe(false);
      expect(error).toHaveBeenCalledWith('Loading pet failed', failure);

      await wrapper.get('.back-btn').trigger('click');
      expect(push).toHaveBeenCalledWith({ name: 'pet', params: { id: pet.id } });
    });

    it('goes home for a pet that does not exist, without leaving the tracker in history', async () => {
      const { wrapper, replace, addReading } = await mountTracker({ stored: [] });
      expect(replace).toHaveBeenCalledWith({ name: 'home' });
      expect(wrapper.find('.heart-btn').exists()).toBe(false);
      expect(addReading).not.toHaveBeenCalled();
    });

    it('does not send the user home after they already left the tracker', async () => {
      const load = deferred<Pet[]>();
      const { wrapper, replace } = await mountTracker({ stored: load.promise });
      wrapper.unmount();
      load.resolve([]);
      await flushPromises();
      expect(replace).not.toHaveBeenCalled();
    });
  });

  it('does not reload pets that are already loaded', async () => {
    const { getAllPets } = await mountTracker();
    expect(getAllPets).not.toHaveBeenCalled();
  });
});
