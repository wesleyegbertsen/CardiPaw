import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
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

const ringOffset = (wrapper: VueWrapper) =>
  Number(wrapper.get('.ring-progress').attributes('stroke-dashoffset'));

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

  // Background tabs, a locked screen and battery saver delay setInterval; jumping the
  // clock without running timers stands in for ticks that arrive late.
  it('finishes after 30 seconds even when timer ticks arrive late', async () => {
    const { wrapper } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    vi.setSystemTime(Date.now() + 31_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(wrapper.get('.result-number').text()).toBe('2');
    expect(audio.playDoneSound).toHaveBeenCalledOnce();
  });

  it('does not count a tap that lands after the 30 seconds are up', async () => {
    const { wrapper } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    await wrapper.get('.heart-btn').trigger('click');
    vi.setSystemTime(Date.now() + 30_500);
    await wrapper.get('.heart-btn').trigger('click');

    expect(wrapper.get('.result-number').text()).toBe('4');
  });

  it('ends on time when a timer fires just before the clock reaches 30 seconds', async () => {
    const { wrapper } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    vi.setSystemTime(Date.now() - 5); // the clock now runs 5 ms behind the timers
    await vi.advanceTimersByTimeAsync(30_250);

    expect(wrapper.find('.result-number').exists()).toBe(true);
  });

  it('shows the seconds left by the clock', async () => {
    const { wrapper } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    expect(ringOffset(wrapper)).toBeCloseTo(339.3);
    // 16.2 s left: rounds up to 17, not to the nearest second.
    vi.setSystemTime(Date.now() + 12_800);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(wrapper.get('.timer-number').text()).toBe('17');
    expect(ringOffset(wrapper)).toBeCloseTo((339.3 * 17) / 30);
  });

  it('never shows more than 30 seconds when the clock moves back', async () => {
    const { wrapper } = await mountTracker();
    await wrapper.get('.heart-btn').trigger('click');
    vi.setSystemTime(Date.now() - 60_000);
    await vi.advanceTimersByTimeAsync(250);

    expect(wrapper.get('.timer-number').text()).toBe('30');
    expect(ringOffset(wrapper)).toBeCloseTo(339.3);
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
      durationSeconds: 30,
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
    expect(addReading.mock.calls[0][0].durationSeconds).toBeUndefined();
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

  it('exposes the mode as pressed buttons in a labelled group', async () => {
    const { wrapper } = await mountTracker();
    const group = wrapper.get('.mode-toggle');
    expect(group.attributes('role')).toBe('group');
    expect(group.attributes('aria-label')).toBe('Measurement mode');
    expect(wrapper.get('.mode-toggle-indicator').attributes('aria-hidden')).toBe('true');
    const pressed = () => wrapper.findAll('.mode-pill').map((p) => p.attributes('aria-pressed'));
    expect(pressed()).toEqual(['true', 'false']);
    await wrapper.findAll('.mode-pill')[1].trigger('click');
    expect(pressed()).toEqual(['false', 'true']);
  });

  it('labels the manual rate and notes fields', async () => {
    const { wrapper } = await mountTracker();
    await wrapper.findAll('.mode-pill')[1].trigger('click');
    expect(wrapper.get('.manual-rate-input').attributes('aria-label')).toBe('Rate (breaths/min)');
    // The label already says breaths/min; the visible unit is not read a second time
    expect(wrapper.get('.manual-rate-unit').attributes('aria-hidden')).toBe('true');
    expect(wrapper.get('.notes-stub').attributes('aria-label')).toBe('Notes');
  });

  it.each(['manual', 'guided'])('exposes the %s rest state as pressed buttons', async (mode) => {
    const { wrapper } = await mountTracker();
    if (mode === 'manual') {
      await wrapper.findAll('.mode-pill')[1].trigger('click');
    } else {
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(wrapper.get('.notes-stub').attributes('aria-label')).toBe('Notes');
    }
    const group = wrapper.get('.rest-state-row');
    expect(group.attributes('role')).toBe('group');
    const labelId = group.attributes('aria-labelledby');
    expect(labelId && document.getElementById(labelId)?.textContent).toBe('Pet was');
    const [resting, sleeping] = wrapper.findAll('.rest-btn');
    const pressed = () => [resting, sleeping].map((b) => b.attributes('aria-pressed'));
    expect(pressed()).toEqual(['false', 'false']);
    await resting.trigger('click');
    expect(pressed()).toEqual(['true', 'false']);
    await resting.trigger('click');
    expect(resting.attributes('aria-pressed')).toBe('false');
  });

  it('names the sound and vibration switches', async () => {
    const { wrapper } = await mountTracker();
    const names = wrapper.findAll('[role="switch"]').map((s) => {
      const id = s.attributes('aria-labelledby');
      return id ? document.getElementById(id)?.textContent : undefined;
    });
    expect(names).toEqual(['Sound', 'Vibration']);
  });

  it.each([
    ['the sound switch', '.slide-toggle'],
    // The two switches share a row; the space between them is not part of the tap area.
    ['the space between the switches', '.toggle-rows'],
    // Around and between the length picker and the switches: a tap that just misses one.
    ['the space around the options', '.tracker-options'],
  ])('tapping %s does not start the measurement', async (_label, selector) => {
    const { wrapper } = await mountTracker();
    await wrapper.get(selector).trigger('click');
    expect(wrapper.find('.timer-ring').exists()).toBe(false);
    expect(audio.playBeep).not.toHaveBeenCalled();
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

  describe('measurement length', () => {
    const PREFS_KEY = 'cardipaw-tracker-prefs';
    const lengthInput = (wrapper: VueWrapper, seconds: number) =>
      wrapper.get<HTMLInputElement>(`.length-picker input[value="${seconds}"]`);

    it('offers 15, 30 and 60 seconds as a named radio group, 30 by default', async () => {
      const { wrapper } = await mountTracker();
      const group = wrapper.get('.length-picker');
      expect(group.attributes('role')).toBe('radiogroup');
      const labelId = group.attributes('aria-labelledby');
      expect(labelId && document.getElementById(labelId)?.textContent).toBe('Measurement length');
      const options = wrapper.findAll('.length-option');
      expect(options.map((o) => o.text())).toEqual(['15 s', '30 s', '60 s']);
      const radios = wrapper.findAll<HTMLInputElement>('.length-picker input[type="radio"]');
      expect(new Set(radios.map((r) => r.attributes('name'))).size).toBe(1);
      expect(radios.map((r) => r.element.checked)).toEqual([false, true, false]);
    });

    it.each([
      ['the radio', (w: VueWrapper) => lengthInput(w, 60).element.click()],
      ['its label', (w: VueWrapper) => w.findAll<HTMLElement>('.length-option')[2].element.click()],
    ])('choosing a length with %s does not start the measurement', async (_label, choose) => {
      const { wrapper } = await mountTracker();
      choose(wrapper);
      await nextTick();
      expect(lengthInput(wrapper, 60).element.checked).toBe(true);
      expect(wrapper.find('.timer-ring').exists()).toBe(false);
      expect(wrapper.get('.heart-btn').attributes('aria-label')).toBe('Tap to start');
      expect(audio.playBeep).not.toHaveBeenCalled();
    });

    it('counts for 15 seconds and scales the taps to a minute', async () => {
      const { wrapper, addReading } = await mountTracker();
      await lengthInput(wrapper, 15).setValue();
      const heart = wrapper.get('.heart-btn');
      for (let i = 0; i < 7; i++) await heart.trigger('click');
      expect(wrapper.get('.timer-number').text()).toBe('15');
      expect(ringOffset(wrapper)).toBeCloseTo(339.3);

      await vi.advanceTimersByTimeAsync(14_750);
      expect(wrapper.find('.result-number').exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(250);
      expect(wrapper.get('.result-number').text()).toBe('28');
      expect(wrapper.get('.result-note').text()).toBe('Based on 7 breaths in 15 seconds');

      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledWith(
        expect.objectContaining({ rate: 28, clickCount: 7, durationSeconds: 15 }),
      );
    });

    it('counts for 60 seconds and shows the time left against 60', async () => {
      const { wrapper, addReading } = await mountTracker();
      await lengthInput(wrapper, 60).setValue();
      const heart = wrapper.get('.heart-btn');
      for (let i = 0; i < 20; i++) await heart.trigger('click');
      expect(wrapper.get('.timer-number').text()).toBe('60');

      vi.setSystemTime(Date.now() + 17_000);
      await vi.advanceTimersByTimeAsync(250);
      expect(wrapper.get('.timer-number').text()).toBe('43');
      expect(ringOffset(wrapper)).toBeCloseTo((339.3 * 43) / 60);

      await vi.advanceTimersByTimeAsync(42_500);
      expect(wrapper.find('.result-number').exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(250);
      expect(wrapper.get('.result-number').text()).toBe('20');
      expect(wrapper.get('.result-note').text()).toBe('Based on 20 breaths in 60 seconds');

      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledWith(
        expect.objectContaining({ rate: 20, clickCount: 20, durationSeconds: 60 }),
      );
    });

    it('never shows more than the chosen length when the clock moves back', async () => {
      const { wrapper } = await mountTracker();
      await lengthInput(wrapper, 60).setValue();
      await wrapper.get('.heart-btn').trigger('click');
      vi.setSystemTime(Date.now() - 60_000);
      await vi.advanceTimersByTimeAsync(250);
      expect(wrapper.get('.timer-number').text()).toBe('60');
      expect(ringOffset(wrapper)).toBeCloseTo(339.3);
    });

    it('hides the picker once the measurement runs', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.get('.heart-btn').trigger('click');
      expect(wrapper.find('.length-picker').exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(wrapper.find('.length-picker').exists()).toBe(false);
    });

    it('is not offered for a manual entry', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.findAll('.mode-pill')[1].trigger('click');
      expect(wrapper.find('.length-picker').exists()).toBe(false);
    });

    it("remembers the pet's length and keeps it on Try again", async () => {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ [pet.id]: { soundEnabled: true, vibrationEnabled: true, measurementSeconds: 60 } }),
      );
      const { wrapper } = await mountTracker();
      expect(lengthInput(wrapper, 60).element.checked).toBe(true);

      await lengthInput(wrapper, 15).setValue();
      expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)[pet.id].measurementSeconds).toBe(15);

      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(15_000);
      await wrapper.get('.btn-retry').trigger('click');
      expect(lengthInput(wrapper, 15).element.checked).toBe(true);
      await wrapper.get('.heart-btn').trigger('click');
      expect(wrapper.get('.timer-number').text()).toBe('15');
    });
  });

  it('does not reload pets that are already loaded', async () => {
    const { getAllPets } = await mountTracker();
    expect(getAllPets).not.toHaveBeenCalled();
  });
});
