import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, type Plugin } from 'vue';
import {
  createMemoryHistory,
  createRouter,
  isNavigationFailure,
  NavigationFailureType,
  RouterView,
  useRoute,
  type RouteLocationRaw,
  type Router,
} from 'vue-router';
import TrackerView from './TrackerView.vue';
import { routes } from '../router';
import { usePetsStore } from '../stores/pets';
import { useReadingsStore } from '../stores/readings';
import { deferred } from '../test/deferred';
import { createTestI18n } from '../test/i18n';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ja from '../i18n/locales/ja.json';
import { closeTopModal } from '../composables/useModal';
import { Blank } from '../test/mountView';
import { makePet, makeReading } from '../test/fixtures';
import { cameraStub } from '../test/stubs';
import { fakeMatchMedia } from '../test/mediaQuery';
import * as db from '../services/db';
import type { Pet, Reading } from '../types';
import type { MeasurementSeconds } from '../utils/measurement';

const audio = vi.hoisted(() => ({ init: vi.fn(), playBeep: vi.fn(), playDoneSound: vi.fn() }));
const haptics = vi.hoisted(() => ({ vibrateTap: vi.fn(), vibrateDone: vi.fn() }));

vi.mock('../composables/useAudioBeep', () => ({ useAudioBeep: () => audio }));
vi.mock('../composables/useHaptics', () => ({
  useHaptics: () => ({ isSupported: true, ...haptics }),
}));
// Both flags seen by default, so no onboarding opens by itself; a test flips one.
const onboarding = vi.hoisted(() => ({
  hasSeenOnboarding: undefined as unknown as { value: boolean },
  hasSeenCameraOnboarding: undefined as unknown as { value: boolean },
  markSeen: vi.fn(),
  markCameraSeen: vi.fn(),
}));
vi.mock('../composables/useOnboarding', async () => {
  const { ref } = await import('vue');
  onboarding.hasSeenOnboarding = ref(true);
  onboarding.hasSeenCameraOnboarding = ref(true);
  return { useOnboarding: () => onboarding };
});
// TipTap needs a real layout engine; a textarea is enough to check the notes reach the save.
vi.mock('../components/LazyRichTextEditor', async () =>
  (await import('../test/stubs')).lazyEditorStubModule(),
);
// The camera opt-in keeps a module-level ref; a mock keeps tests order-independent.
const camera = vi.hoisted(() => ({
  enabled: undefined as unknown as { value: boolean },
  supported: true,
  setEnabled: vi.fn(),
}));
vi.mock('../composables/useCameraOptIn', async () => {
  const { ref } = await import('vue');
  camera.enabled = ref(false);
  return {
    useCameraOptIn: () => ({ enabled: camera.enabled, setEnabled: camera.setEnabled }),
    isCameraSupported: () => camera.supported,
  };
});
// The app hides the system bars in the full-screen camera layout; the website has no plugin.
const platform = vi.hoisted(() => ({ native: false }));
vi.mock('../utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/platform')>()),
  isNative: () => platform.native,
}));
const immersiveMode = vi.hoisted(() => ({ enter: vi.fn(), exit: vi.fn() }));
vi.mock('../native/immersiveMode', () => ({ ImmersiveMode: immersiveMode }));
// Loaded through defineAsyncComponent, so the module is mocked rather than the component stubbed.
vi.mock('../components/CameraCapture.vue', async () =>
  (await import('../test/stubs')).cameraCaptureStubModule(),
);

const pet = makePet();
let router: Router;

/**
 * `stored` set: the pets store starts empty, as on a reload straight into the tracker, and
 * loading pets resolves with `stored` (or rejects, for an Error; or settles with a Promise).
 * `i18n` replaces the default English instance. `from` is opened first, so there is a
 * screen to go back to.
 */
async function mountTracker({
  stored,
  i18n = createTestI18n(),
  from,
}: { stored?: Pet[] | Error | Promise<Pet[]>; i18n?: Plugin; from?: RouteLocationRaw } = {}) {
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
  // The real view renders on its own route, so its route guards run (they need a RouterView).
  router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((r) => ({ ...r, component: r.name === 'tracker' ? TrackerView : Blank })),
  });
  if (from) await router.push(from);
  await router.push({ name: 'tracker', params: { id: pet.id } });
  await router.isReady();

  const push = vi.spyOn(router, 'push');
  const replace = vi.spyOn(router, 'replace');

  // Keyed like App.vue, so another pet's tracker remounts the view as in the app.
  const Host = defineComponent({
    setup() {
      const route = useRoute();
      return () => h(RouterView, { key: route.path });
    },
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [pinia, router, i18n] },
  });
  await flushPromises();
  return { wrapper, addReading, getAllPets, push, replace };
}

const ringOffset = (wrapper: VueWrapper) =>
  Number(wrapper.get('.ring-progress').attributes('stroke-dashoffset'));

const lengthPill = (wrapper: VueWrapper, seconds: MeasurementSeconds) =>
  wrapper.findAll('.length-pill').find((p) => p.text() === `${seconds} s`)!;
const pressedLengths = (wrapper: VueWrapper) =>
  wrapper.findAll('.length-pill').map((p) => p.attributes('aria-pressed'));
const i18nFor = (locale: 'de' | 'ja') =>
  createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, de, ja } });

// Opened before the tracker, so a back gesture has somewhere to go.
const petPage = { name: 'pet', params: { id: pet.id } } as const;
// The leave dialog is teleported to <body>, outside the wrapper.
const dialog = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const clickInDialog = (button: '.btn-cancel' | '.btn-confirm') =>
  dialog()!.querySelector<HTMLElement>(button)!.click();
// Discard ignores taps for its first 500 ms (breath taps meant for the heart), so wait first.
const discardInDialog = () => {
  vi.advanceTimersByTime(500);
  clickInDialog('.btn-confirm');
};

describe('TrackerView', () => {
  beforeEach(() => {
    // Hoisted spies outlive each test, so clear their calls to keep tests order-independent.
    for (const fn of [...Object.values(audio), ...Object.values(haptics)]) fn.mockClear();
    localStorage.clear();
    camera.enabled.value = false;
    camera.supported = true;
    cameraStub.nextResult = { rate: 24, seconds: 30, interval: [23, 25], taps: null };
    cameraStub.mounts = 0;
    cameraStub.unmounts = 0;
    onboarding.hasSeenOnboarding.value = true;
    onboarding.hasSeenCameraOnboarding.value = true;
    onboarding.markSeen.mockReset();
    onboarding.markCameraSeen.mockReset();
    // Upright unless a test turns the phone; happy-dom would answer the query by its own size.
    fakeMatchMedia(false);
    platform.native = false;
    immersiveMode.enter.mockReset().mockResolvedValue(undefined);
    immersiveMode.exit.mockReset().mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('camera mode', () => {
    const pills = (wrapper: VueWrapper) => wrapper.findAll('.mode-pill').map((p) => p.text());
    async function mountCamera(options?: Parameters<typeof mountTracker>[0]) {
      camera.enabled.value = true;
      const mounted = await mountTracker(options);
      await mounted.wrapper.findAll('.mode-pill')[2].trigger('click');
      await flushPromises(); // the async component resolves
      return mounted;
    }
    const suggest = async (wrapper: VueWrapper) => {
      await wrapper.get('.stub-result').trigger('click');
      await flushPromises();
    };

    it('offers the Camera pill only with the opt-in on and getUserMedia present', async () => {
      expect(pills((await mountTracker()).wrapper)).toEqual(['Guided', 'Manual']);
      camera.enabled.value = true;
      camera.supported = false;
      expect(pills((await mountTracker()).wrapper)).toEqual(['Guided', 'Manual']);
      camera.supported = true;
      expect(pills((await mountTracker()).wrapper)).toEqual(['Guided', 'Manual', 'Camera']);
    });

    it('moves the indicator by index and mounts the capture without opening the camera', async () => {
      const { wrapper } = await mountCamera();
      const indicator = wrapper.get<HTMLElement>('.mode-toggle-indicator').element.style;
      expect(indicator.getPropertyValue('--count')).toBe('3');
      expect(indicator.getPropertyValue('--index')).toBe('2');
      expect(wrapper.findAll('.mode-pill').map((p) => p.attributes('aria-pressed'))).toEqual([
        'false',
        'false',
        'true',
      ]);
      expect(wrapper.get('.camera-stub').attributes('data-auto-open')).toBe('false');
      expect(wrapper.find('.heart-btn').exists()).toBe(false);
    });

    it('shows a suggested count as a card and saves nothing until Confirm', async () => {
      const { wrapper, addReading } = await mountCamera();
      await suggest(wrapper);
      expect(wrapper.find('.camera-stub').exists()).toBe(false);
      expect(wrapper.get('.experimental-chip').text()).toBe('Experimental');
      expect(wrapper.get('.result-title').text()).toBe('Suggested count');
      expect(wrapper.get('.result-number').text()).toBe('24');
      expect(wrapper.get('.rate-badge').classes()).toContain('normal');
      expect(wrapper.get('.result-note').text()).toBe(
        'From the camera over 30 seconds: between 23 and 25 breaths/min. Check it against your pet before saving.',
      );
      expect(wrapper.find('.save-choice').exists()).toBe(false);
      expect(document.activeElement).toBe(wrapper.get('.result').element);
      expect(addReading).not.toHaveBeenCalled();

      await wrapper.findAll('.rest-btn')[1].trigger('click');
      await wrapper.get('.notes-stub').setValue('<p>calm</p>');
      expect(wrapper.get('.btn-save').text()).toBe('Confirm and save');
      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledExactlyOnceWith({
        petId: pet.id,
        date: '2024-03-15T12:00:00.000Z',
        rate: 24,
        clickCount: 0,
        restState: 'sleeping',
        notes: '<p>calm</p>',
        source: 'camera',
        durationSeconds: 30,
      });
      expect(router.currentRoute.value.name).toBe('pet');
    });

    it('rates the suggestion against the pet’s own ceilings and keeps the 60 s length', async () => {
      cameraStub.nextResult = { rate: 32, seconds: 60, interval: [31, 33], taps: null };
      const { wrapper, addReading } = await mountCamera();
      await suggest(wrapper);
      expect(wrapper.get('.rate-badge').classes()).toContain('warning');
      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledWith(
        expect.objectContaining({ rate: 32, source: 'camera', durationSeconds: 60 }),
      );
    });

    it('lets the owner save their own taps as a guided reading instead', async () => {
      cameraStub.nextResult = { rate: 24, seconds: 30, interval: [23, 25], taps: 13 };
      const { wrapper, addReading } = await mountCamera();
      await suggest(wrapper);
      const group = wrapper.get('.save-choice');
      expect(group.attributes('role')).toBe('group');
      const labelId = group.attributes('aria-labelledby');
      expect(labelId && document.getElementById(labelId)?.textContent).toBe(
        'Your count: 26 breaths/min',
      );
      const [cameraChoice, tapsChoice] = group.findAll('button');
      expect(cameraChoice.text()).toBe('Save the camera count');
      expect(tapsChoice.text()).toBe('Save my count (26)');
      expect(cameraChoice.attributes('aria-pressed')).toBe('true');
      expect(tapsChoice.attributes('aria-pressed')).toBe('false');
      await tapsChoice.trigger('click');
      expect(tapsChoice.attributes('aria-pressed')).toBe('true');
      expect(cameraChoice.attributes('aria-pressed')).toBe('false');

      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ rate: 26, clickCount: 13, source: undefined, durationSeconds: 30 }),
      );
      expect(addReading.mock.calls[0][0].source).toBeUndefined();
    });

    it('saves the camera count by default even when the owner tapped along', async () => {
      cameraStub.nextResult = { rate: 24, seconds: 30, interval: [23, 25], taps: 13 };
      const { wrapper, addReading } = await mountCamera();
      await suggest(wrapper);
      expect(wrapper.find('.save-choice').exists()).toBe(true);
      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ rate: 24, clickCount: 0, source: 'camera', durationSeconds: 30 }),
      );
    });

    it('measures again by remounting the capture with the camera opening by itself', async () => {
      cameraStub.nextResult = { rate: 24, seconds: 30, interval: [23, 25], taps: 13 };
      const { wrapper, addReading } = await mountCamera();
      await suggest(wrapper);
      await wrapper.findAll('.save-choice button')[1].trigger('click');
      await wrapper.get('.btn-retry').trigger('click');
      await flushPromises();
      expect(wrapper.find('.result-number').exists()).toBe(false);
      expect(wrapper.get('.camera-stub').attributes('data-auto-open')).toBe('true');

      // A second suggestion starts from the camera choice again.
      await suggest(wrapper);
      expect(wrapper.findAll('.save-choice button')[0].attributes('aria-pressed')).toBe('true');
      expect(addReading).not.toHaveBeenCalled();
    });

    it('hides the mode bar under a suggestion, so a pill cannot discard it', async () => {
      const { wrapper } = await mountCamera();
      await suggest(wrapper);
      expect(wrapper.find('.mode-toggle-bar').exists()).toBe(false);
      expect(wrapper.get('.camera-body').classes()).not.toContain('with-bar');
      await wrapper.get('.btn-retry').trigger('click');
      await flushPromises();
      expect(wrapper.find('.mode-toggle-bar').exists()).toBe(true);
      expect(wrapper.get('.camera-body').classes()).toContain('with-bar');
    });

    it('discards a suggestion and returns to the pet', async () => {
      const { wrapper, addReading, replace } = await mountCamera();
      await suggest(wrapper);
      await wrapper.get('.btn-discard').trigger('click');
      expect(addReading).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith({ name: 'pet', params: { id: pet.id } });
    });

    it('reports a failed save and keeps the suggestion', async () => {
      const { wrapper, addReading } = await mountCamera();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      addReading.mockRejectedValueOnce(new Error('quota exceeded'));
      await suggest(wrapper);
      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toBe(
        'The reading could not be saved. Please try again.',
      );
      expect(wrapper.get('.result-number').text()).toBe('24');
      expect(router.currentRoute.value.name).toBe('tracker');
    });

    it('switches to guided on Count by tapping instead', async () => {
      const { wrapper } = await mountCamera();
      await wrapper.get('.stub-tap-instead').trigger('click');
      expect(wrapper.find('.camera-stub').exists()).toBe(false);
      expect(wrapper.find('.heart-btn').exists()).toBe(true);
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('.heart-btn').element);
      expect(wrapper.findAll('.mode-pill').map((p) => p.attributes('aria-pressed'))).toEqual([
        'true',
        'false',
        'false',
      ]);
    });

    // Placing loses nothing, and with a remembered grant the camera opens straight into it:
    // the pills are the way to another mode. Only a running count hides them.
    it('keeps the mode bar while the camera is placing and hides it while capturing', async () => {
      const { wrapper } = await mountCamera();
      expect(wrapper.find('.mode-toggle-bar').exists()).toBe(true);
      await wrapper.get('.stub-busy').trigger('click');
      expect(wrapper.find('.mode-toggle-bar').exists()).toBe(true);
      await wrapper.get('.stub-capturing').trigger('click');
      expect(wrapper.find('.mode-toggle-bar').exists()).toBe(false);
      await wrapper.get('.stub-idle').trigger('click');
      expect(wrapper.find('.mode-toggle-bar').exists()).toBe(true);
    });

    const helpDialog = () => document.body.querySelector('[role="dialog"]');

    it('opens the camera steps the first time the Camera pill is tapped, once', async () => {
      onboarding.hasSeenCameraOnboarding.value = false;
      const { wrapper } = await mountCamera();
      expect(helpDialog()?.textContent).toContain('Prop the phone up');
      expect(helpDialog()?.textContent).toContain('Step 1 of 4');
      expect(wrapper.find('.camera-stub').exists()).toBe(true);

      document.body.querySelector<HTMLButtonElement>('.btn-skip')!.click();
      await flushPromises();
      expect(helpDialog()).toBeNull();
      expect(onboarding.markCameraSeen).toHaveBeenCalledOnce();
      expect(onboarding.markSeen).not.toHaveBeenCalled();

      onboarding.hasSeenCameraOnboarding.value = true; // what markCameraSeen does
      await wrapper.findAll('.mode-pill')[0].trigger('click');
      await wrapper.findAll('.mode-pill')[2].trigger('click');
      await flushPromises();
      expect(helpDialog()).toBeNull();
    });

    // The capture opens the camera by itself once it was allowed (CameraCapture.test.ts); the
    // stub cannot, so here only the hold is checked: never under the first camera onboarding.
    it('holds the capture while the camera onboarding is open, and only then', async () => {
      onboarding.hasSeenCameraOnboarding.value = false;
      const { wrapper } = await mountCamera();
      expect(helpDialog()).not.toBeNull();
      expect(wrapper.get('.camera-stub').attributes('data-hold')).toBe('true');
      document.body.querySelector<HTMLButtonElement>('.btn-skip')!.click();
      await flushPromises();
      expect(wrapper.get('.camera-stub').attributes('data-hold')).toBe('false');
    });

    it('does not hold the capture once the camera onboarding was seen', async () => {
      const { wrapper } = await mountCamera();
      expect(helpDialog()).toBeNull();
      expect(wrapper.get('.camera-stub').attributes('data-hold')).toBe('false');
    });

    it('explains the current mode from the ? button', async () => {
      const { wrapper } = await mountCamera();
      expect(helpDialog()).toBeNull();
      await wrapper.get('.help-btn').trigger('click');
      expect(helpDialog()?.textContent).toContain('Prop the phone up');
      document.body.querySelector<HTMLButtonElement>('.btn-skip')!.click();
      await flushPromises();
      expect(onboarding.markCameraSeen).toHaveBeenCalledOnce();

      await wrapper.findAll('.mode-pill')[0].trigger('click');
      await wrapper.get('.help-btn').trigger('click');
      expect(helpDialog()?.textContent).toContain('Get your pet resting or sleeping');
      document.body.querySelector<HTMLButtonElement>('.btn-skip')!.click();
      await flushPromises();
      expect(onboarding.markSeen).toHaveBeenCalledOnce();
      expect(onboarding.markCameraSeen).toHaveBeenCalledOnce();
    });

    it('leaves the capture behind when switching back to guided, even while busy', async () => {
      const { wrapper } = await mountCamera();
      await wrapper.get('.stub-busy').trigger('click');
      await wrapper.get('.stub-tap-instead').trigger('click');
      expect(wrapper.find('.camera-stub').exists()).toBe(false);
      expect(wrapper.find('.mode-toggle-bar').exists()).toBe(true);
      await wrapper.findAll('.mode-pill')[2].trigger('click');
      await flushPromises();
      expect(wrapper.find('.camera-stub').exists()).toBe(true);
      await wrapper.findAll('.mode-pill')[0].trigger('click');
      expect(wrapper.find('.camera-stub').exists()).toBe(false);
    });

    describe('leaving', () => {
      it('asks before going back during a capture, and Cancel keeps the camera running', async () => {
        const { wrapper } = await mountCamera({ from: petPage });
        await wrapper.get('.stub-capturing').trigger('click');
        router.back();
        await flushPromises();
        expect(dialog()?.querySelector('.message')?.textContent).toBe(en.tracker.leaveConfirm);

        clickInDialog('.btn-cancel');
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(router.currentRoute.value.name).toBe('tracker');
        expect(wrapper.find('.camera-stub').exists()).toBe(true);
        expect([cameraStub.mounts, cameraStub.unmounts]).toEqual([1, 0]);
      });

      it('lets Discard leave a capture, which closes the camera', async () => {
        const { wrapper } = await mountCamera({ from: petPage });
        await wrapper.get('.stub-capturing').trigger('click');
        router.back();
        await flushPromises();
        expect(dialog()).not.toBeNull();

        discardInDialog();
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('pet');
        expect(wrapper.find('.tracker').exists()).toBe(false);
        expect(cameraStub.unmounts).toBe(1);
      });

      it('asks before leaving a suggestion that is not confirmed', async () => {
        const { wrapper } = await mountCamera({ from: petPage });
        await suggest(wrapper);
        await wrapper.get('.back-btn').trigger('click');
        await flushPromises();
        expect(dialog()).not.toBeNull();
        expect(router.currentRoute.value.name).toBe('tracker');
      });

      // The capture can end behind the dialog: focus stays in it, and Cancel moves it to the card.
      it('keeps focus in the dialog when the suggestion arrives behind it', async () => {
        const { wrapper } = await mountCamera({ from: petPage });
        await wrapper.get('.stub-capturing').trigger('click');
        router.back();
        await flushPromises();
        await suggest(wrapper);
        expect(dialog()!.contains(document.activeElement)).toBe(true);

        clickInDialog('.btn-cancel');
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.get('.result').element);
      });

      it.each<[string, (wrapper: VueWrapper) => Promise<unknown>]>([
        ['on the explanation', async () => {}],
        ['while placing the camera', (w) => w.get('.stub-busy').trigger('click')],
        [
          'after an abstain or an interrupted capture',
          async (w) => {
            await w.get('.stub-capturing').trigger('click');
            await w.get('.stub-idle').trigger('click');
          },
        ],
      ])('leaves without asking %s', async (_, prepare) => {
        const { wrapper } = await mountCamera({ from: petPage });
        await prepare(wrapper);
        router.back();
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(router.currentRoute.value.name).toBe('pet');
      });

      it.each([
        ['.btn-save', 'Confirm'],
        ['.btn-discard', 'Discard'],
      ])('leaves without asking on %s (%s)', async (button) => {
        const { wrapper, addReading } = await mountCamera({ from: petPage });
        await suggest(wrapper);
        await wrapper.get(button).trigger('click');
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(router.currentRoute.value.name).toBe('pet');
        expect(addReading).toHaveBeenCalledTimes(button === '.btn-save' ? 1 : 0);
      });

      it('still asks after a failed save', async () => {
        const { wrapper, addReading } = await mountCamera({ from: petPage });
        await suggest(wrapper);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        addReading.mockRejectedValueOnce(new Error('quota exceeded'));
        await wrapper.get('.btn-save').trigger('click');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        router.back();
        await flushPromises();
        expect(dialog()).not.toBeNull();
      });
    });

    // A phone propped sideways to film the pet: the camera takes the whole screen.
    describe('sideways', () => {
      const tracker = (wrapper: VueWrapper) => wrapper.get('.tracker');
      const isImmersive = (wrapper: VueWrapper) => tracker(wrapper).classes().includes('immersive');
      const barCalls = () => [immersiveMode.enter.mock.calls.length, immersiveMode.exit.mock.calls.length];

      it('fills the screen in camera mode on a landscape touch screen, in the dark', async () => {
        fakeMatchMedia(true);
        const { wrapper } = await mountCamera();
        expect(isImmersive(wrapper)).toBe(true);
        expect(tracker(wrapper).attributes('data-theme')).toBe('dark');
        expect(wrapper.get('.camera-stub').attributes('data-landscape')).toBe('true');
      });

      it('keeps the normal layout upright', async () => {
        const { wrapper } = await mountCamera();
        expect(isImmersive(wrapper)).toBe(false);
        expect(tracker(wrapper).attributes('data-theme')).toBeUndefined();
        expect(wrapper.get('.camera-stub').attributes('data-landscape')).toBe('false');
      });

      it.each([0, 1])('keeps the normal layout sideways in the other modes (pill %i)', async (pill) => {
        fakeMatchMedia(true);
        const { wrapper } = await mountCamera();
        await wrapper.findAll('.mode-pill')[pill].trigger('click');
        expect(isImmersive(wrapper)).toBe(false);
      });

      it('follows the phone as it turns, keeping the capture mounted', async () => {
        const media = fakeMatchMedia(false);
        const { wrapper } = await mountCamera();
        media.set(true);
        await flushPromises();
        expect(isImmersive(wrapper)).toBe(true);
        media.set(false);
        await flushPromises();
        expect(isImmersive(wrapper)).toBe(false);
        expect([cameraStub.mounts, cameraStub.unmounts]).toEqual([1, 0]);
      });

      it('keeps the mode pills where the upright bar would show them', async () => {
        fakeMatchMedia(true);
        const { wrapper } = await mountCamera();
        expect(wrapper.find('.mode-toggle').exists()).toBe(true);
        await wrapper.get('.stub-busy').trigger('click');
        expect(wrapper.find('.mode-toggle').exists()).toBe(true);
        await wrapper.get('.stub-capturing').trigger('click');
        expect(wrapper.find('.mode-toggle').exists()).toBe(false);
      });

      it('shows the suggested number on the left, for the eye only', async () => {
        const media = fakeMatchMedia(true);
        const { wrapper } = await mountCamera();
        await suggest(wrapper);
        const left = wrapper.get('.camera-result-preview');
        expect(left.attributes('aria-hidden')).toBe('true');
        expect(left.text()).toContain('24');
        // The card keeps the read-out number, the focus target, with the rest of the card.
        expect(wrapper.get('.camera-result .result').text()).toContain('24');
        expect(wrapper.get('.camera-result').find('.btn-save').exists()).toBe(true);
        media.set(false);
        await flushPromises();
        expect(wrapper.find('.camera-result-preview').exists()).toBe(false);
      });

      it('asks before the back button leaves a running capture', async () => {
        fakeMatchMedia(true);
        const { wrapper } = await mountCamera({ from: petPage });
        await wrapper.get('.stub-capturing').trigger('click');
        await wrapper.get('.back-btn').trigger('click');
        await flushPromises();
        expect(dialog()?.querySelector('.message')?.textContent).toBe(en.tracker.leaveConfirm);
        expect(router.currentRoute.value.name).toBe('tracker');
        clickInDialog('.btn-cancel');
        await flushPromises();
        expect(isImmersive(wrapper)).toBe(true);
      });

      it('never touches the system bars on the website', async () => {
        const media = fakeMatchMedia(true);
        const { wrapper } = await mountCamera();
        media.set(false);
        await flushPromises();
        wrapper.unmount();
        await flushPromises();
        expect(barCalls()).toEqual([0, 0]);
      });

      describe('system bars in the app', () => {
        beforeEach(() => {
          platform.native = true;
        });

        it('hides them on entering the full screen and shows them on turning back', async () => {
          const media = fakeMatchMedia(false);
          await mountCamera();
          expect(barCalls()).toEqual([0, 0]);
          media.set(true);
          await flushPromises();
          expect(barCalls()).toEqual([1, 0]);
          media.set(false);
          await flushPromises();
          expect(barCalls()).toEqual([1, 1]);
        });

        it('shows them when another mode leaves the full screen', async () => {
          fakeMatchMedia(true);
          const { wrapper } = await mountCamera();
          expect(barCalls()).toEqual([1, 0]);
          await wrapper.findAll('.mode-pill')[0].trigger('click');
          await flushPromises();
          expect(barCalls()).toEqual([1, 1]);
        });

        it('shows them when the tracker closes in full screen', async () => {
          fakeMatchMedia(true);
          const { wrapper } = await mountCamera();
          wrapper.unmount();
          await flushPromises();
          expect(barCalls()).toEqual([1, 1]);
        });

        it('leaves them alone when the tracker closes upright', async () => {
          const { wrapper } = await mountCamera();
          wrapper.unmount();
          await flushPromises();
          expect(barCalls()).toEqual([0, 0]);
        });

        it('warns when the bars cannot be hidden, and keeps the full screen', async () => {
          const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
          const failure = new Error('no window');
          immersiveMode.enter.mockRejectedValueOnce(failure);
          fakeMatchMedia(true);
          const { wrapper } = await mountCamera();
          expect(warn).toHaveBeenCalledExactlyOnceWith('Hiding the system bars failed', failure);
          expect(isImmersive(wrapper)).toBe(true);
        });

        it('warns when the bars cannot be shown again', async () => {
          const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
          const failure = new Error('no window');
          immersiveMode.exit.mockRejectedValueOnce(failure);
          const media = fakeMatchMedia(true);
          const { wrapper } = await mountCamera();
          media.set(false);
          await flushPromises();
          expect(warn).toHaveBeenCalledExactlyOnceWith('Showing the system bars failed', failure);
          expect(isImmersive(wrapper)).toBe(false);
        });
      });
    });
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

  it('shows the seconds unit in the app language', async () => {
    const { wrapper } = await mountTracker({ i18n: i18nFor('de') });
    await wrapper.get('.heart-btn').trigger('click');
    expect(wrapper.get('.timer-unit').text()).toBe('Sek.');
  });

  describe('measurement length', () => {
    it('counts taps for 15 seconds and saves the length with the reading', async () => {
      const { wrapper, addReading } = await mountTracker();
      await lengthPill(wrapper, 15).trigger('click');
      const heart = wrapper.get('.heart-btn');
      await heart.trigger('click');
      await heart.trigger('click');
      await heart.trigger('click');
      expect(wrapper.get('.timer-number').text()).toBe('15');

      await vi.advanceTimersByTimeAsync(14_000);
      expect(wrapper.find('.result-number').exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(wrapper.get('.result-number').text()).toBe('12');
      expect(wrapper.get('.result-note').text()).toBe('Based on 3 breaths in 15 seconds');

      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledWith(
        expect.objectContaining({ rate: 12, clickCount: 3, durationSeconds: 15 }),
      );
    });

    it('runs a 60-second measurement', async () => {
      const { wrapper, addReading } = await mountTracker();
      await lengthPill(wrapper, 60).trigger('click');
      await wrapper.get('.heart-btn').trigger('click');
      vi.setSystemTime(Date.now() + 15_000);
      await vi.advanceTimersByTimeAsync(250);
      expect(wrapper.get('.timer-number').text()).toBe('45');
      expect(ringOffset(wrapper)).toBeCloseTo((339.3 * 45) / 60);

      await vi.advanceTimersByTimeAsync(44_000);
      expect(wrapper.find('.result-number').exists()).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(wrapper.get('.result-number').text()).toBe('1');
      expect(wrapper.get('.result-note').text()).toBe('Based on 1 breath in 60 seconds');

      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(addReading).toHaveBeenCalledWith(
        expect.objectContaining({ rate: 1, clickCount: 1, durationSeconds: 60 }),
      );
    });

    it('never shows more than 60 seconds when the clock moves back', async () => {
      const { wrapper } = await mountTracker();
      await lengthPill(wrapper, 60).trigger('click');
      await wrapper.get('.heart-btn').trigger('click');
      vi.setSystemTime(Date.now() - 60_000);
      await vi.advanceTimersByTimeAsync(250);

      expect(wrapper.get('.timer-number').text()).toBe('60');
      expect(ringOffset(wrapper)).toBeCloseTo(339.3);
    });

    it('offers the lengths as pressed buttons in a labelled group, 30 seconds by default', async () => {
      const { wrapper } = await mountTracker();
      const group = wrapper.get('.length-toggle');
      expect(group.attributes('role')).toBe('group');
      expect(group.attributes('aria-label')).toBe('Measurement length');
      expect(wrapper.findAll('.length-pill').map((p) => p.text())).toEqual(['15 s', '30 s', '60 s']);
      expect(pressedLengths(wrapper)).toEqual(['false', 'true', 'false']);
    });

    it('picks a length without starting a measurement and remembers it for the pet', async () => {
      const { wrapper } = await mountTracker();
      await lengthPill(wrapper, 60).trigger('click');
      expect(pressedLengths(wrapper)).toEqual(['false', 'false', 'true']);
      expect(wrapper.find('.timer-ring').exists()).toBe(false);
      expect(audio.playBeep).not.toHaveBeenCalled();
      expect(JSON.parse(localStorage.getItem('cardipaw-tracker-prefs')!)[pet.id]).toMatchObject({
        durationSeconds: 60,
      });
    });

    it('does not start a measurement on a tap that just misses the length pills', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.get('.length-row').trigger('click');
      expect(wrapper.find('.timer-ring').exists()).toBe(false);
      expect(audio.playBeep).not.toHaveBeenCalled();
    });

    it('starts with the pet’s saved length', async () => {
      localStorage.setItem(
        'cardipaw-tracker-prefs',
        JSON.stringify({ [pet.id]: { soundEnabled: true, vibrationEnabled: true, durationSeconds: 60 } }),
      );
      const { wrapper } = await mountTracker();
      expect(pressedLengths(wrapper)).toEqual(['false', 'false', 'true']);
      await wrapper.get('.heart-btn').trigger('click');
      expect(wrapper.get('.timer-number').text()).toBe('60');
    });

    it('hides the length choice while measuring', async () => {
      const { wrapper } = await mountTracker();
      expect(wrapper.find('.length-toggle').exists()).toBe(true);
      await wrapper.get('.heart-btn').trigger('click');
      expect(wrapper.find('.length-toggle').exists()).toBe(false);
    });

    it('keeps the chosen length on Try again', async () => {
      const { wrapper } = await mountTracker();
      await lengthPill(wrapper, 15).trigger('click');
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(15_000);
      await wrapper.get('.btn-retry').trigger('click');

      expect(pressedLengths(wrapper)).toEqual(['true', 'false', 'false']);
      await wrapper.get('.heart-btn').trigger('click');
      expect(wrapper.get('.timer-number').text()).toBe('15');
    });

    it('describes the result in Japanese with one form for any count', async () => {
      const { wrapper } = await mountTracker({ i18n: i18nFor('ja') });
      await wrapper.findAll('.length-pill')[2].trigger('click');
      await wrapper.get('.heart-btn').trigger('click');
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wrapper.get('.result-note').text()).toBe('60秒間で2回の呼吸に基づく');
    });
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
    // toHaveBeenCalledWith treats an undefined property as missing, so check it directly.
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
    const { wrapper, addReading, replace } = await mountTracker();
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
    expect(replace).not.toHaveBeenCalled();
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
    expect(replace).toHaveBeenCalledWith({ name: 'pet', params: { id: pet.id } });
  });

  describe('after a failed save', () => {
    async function failSave(wrapper: VueWrapper, addReading: MockInstance) {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      addReading.mockRejectedValueOnce(new Error('quota exceeded'));
      await wrapper.get('.btn-save').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    }

    it('still asks before leaving', async () => {
      const { wrapper, addReading } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(30_000);
      await failSave(wrapper, addReading);
      router.back();
      await flushPromises();
      expect(dialog()).not.toBeNull();
    });

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
      const { wrapper, addReading, replace } = await mountTracker();
      await wrapper.findAll('.mode-pill')[1].trigger('click');
      await wrapper.get('.manual-rate-input').setValue('42');
      await failSave(wrapper, addReading);

      await wrapper.get('.btn-discard').trigger('click');
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(replace).toHaveBeenCalledWith({ name: 'pet', params: { id: pet.id } });
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

  it('turns the sound off with its switch and remembers it for the pet', async () => {
    const { wrapper } = await mountTracker();
    const sound = wrapper
      .findAll('[role="switch"]')
      .find((s) => document.getElementById(s.attributes('aria-labelledby')!)?.textContent === 'Sound')!;
    expect(sound.attributes('aria-checked')).toBe('true');
    await sound.trigger('click');
    expect(sound.attributes('aria-checked')).toBe('false');
    expect(JSON.parse(localStorage.getItem('cardipaw-tracker-prefs')!)[pet.id]).toMatchObject({
      soundEnabled: false,
    });
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

  describe('screen wake lock', () => {
    let request: ReturnType<typeof vi.fn>;
    let sentinels: { release: MockInstance<() => Promise<void>>; released: boolean }[];

    beforeEach(() => {
      sentinels = [];
      request = vi.fn(async () => {
        const sentinel = Object.assign(new EventTarget(), {
          released: false,
          type: 'screen' as const,
          onrelease: null,
          release: vi.fn(async () => {
            sentinel.released = true;
          }),
        });
        sentinels.push(sentinel);
        return sentinel;
      });
      // happy-dom has no Screen Wake Lock API, so the rest of this file runs without one.
      // Set on the real navigator: a stand-in object breaks happy-dom's own getters
      // (userAgent), which Vue reads when the first component in this file mounts.
      Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    });

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'wakeLock');
    });

    it.each([15, 30, 60] as const)(
      'keeps the screen on for a %i-second count and lets it sleep when the count ends',
      async (seconds) => {
        const { wrapper } = await mountTracker();
        await lengthPill(wrapper, seconds).trigger('click');
        expect(request).not.toHaveBeenCalled();
        await wrapper.get('.heart-btn').trigger('click');
        expect(request).toHaveBeenCalledExactlyOnceWith('screen');

        await vi.advanceTimersByTimeAsync((seconds - 1) * 1000);
        expect(sentinels[0].release).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(wrapper.find('.result-number').exists()).toBe(true);
        expect(sentinels[0].release).toHaveBeenCalledOnce();
      },
    );

    it('lets the screen sleep when the count ends on a late tap', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.get('.heart-btn').trigger('click');
      await flushPromises();
      vi.setSystemTime(Date.now() + 30_500);
      await wrapper.get('.heart-btn').trigger('click');
      expect(sentinels[0].release).toHaveBeenCalledOnce();
    });

    it('lets the screen sleep when leaving mid-count', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.get('.heart-btn').trigger('click');
      await flushPromises();
      wrapper.unmount();
      expect(sentinels[0].release).toHaveBeenCalledOnce();
    });

    it('keeps the screen on while asking to leave, then lets it sleep on Discard', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      await flushPromises();
      router.back();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(dialog()).not.toBeNull();
      expect(sentinels[0].release).not.toHaveBeenCalled();

      clickInDialog('.btn-confirm');
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('pet');
      expect(sentinels[0].release).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(audio.playDoneSound).not.toHaveBeenCalled();
      expect(haptics.vibrateDone).not.toHaveBeenCalled();
    });

    it('keeps the screen on again for a count started with Try again', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(30_000);
      await wrapper.get('.btn-retry').trigger('click');
      expect(request).toHaveBeenCalledOnce();

      await wrapper.get('.heart-btn').trigger('click');
      await flushPromises();
      expect(request).toHaveBeenCalledTimes(2);
      expect(sentinels[1].release).not.toHaveBeenCalled();
    });
  });

  describe('leaving', () => {
    it('asks before going back during a count, and Cancel keeps counting', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      router.back();
      await flushPromises();
      expect(dialog()?.querySelector('.message')?.textContent).toBe(en.tracker.leaveConfirm);
      expect(dialog()?.querySelector('.btn-confirm')?.textContent).toBe('Discard');

      clickInDialog('.btn-cancel');
      await flushPromises();
      expect(dialog()).toBeNull();
      expect(router.currentRoute.value.name).toBe('tracker');
      // The back already moved history; Cancel moves it forward again.
      expect(router.options.history.location).toBe(`/pets/${pet.id}/track`);
      await wrapper.get('.heart-btn').trigger('click');
      expect(wrapper.get('.count-number').text()).toBe('2');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(wrapper.get('.result-number').text()).toBe('4');
    });

    // The dialog opens over the heart: the next breath tap may land on Discard.
    it('ignores a Discard tap right after the dialog opens', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      router.back();
      await flushPromises();
      clickInDialog('.btn-confirm');
      await flushPromises();
      expect(dialog()).not.toBeNull();
      expect(router.currentRoute.value.name).toBe('tracker');
      expect(wrapper.get('.count-number').text()).toBe('1');

      await vi.advanceTimersByTimeAsync(500);
      clickInDialog('.btn-confirm');
      await flushPromises();
      expect(dialog()).toBeNull();
      expect(router.currentRoute.value.name).toBe('pet');
    });

    it('asks before leaving a finished result that is not saved', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      await vi.advanceTimersByTimeAsync(30_000);
      router.back();
      await flushPromises();
      expect(dialog()).not.toBeNull();

      clickInDialog('.btn-cancel');
      await flushPromises();
      expect(wrapper.get('.result-number').text()).toBe('2');
      // Focus goes back to the result, where the end of the count put it.
      expect(document.activeElement).toBe(wrapper.get('.result').element);
    });

    it.each<[string, (wrapper: VueWrapper) => Promise<unknown>]>([
      ['a rate', (w) => w.get('.manual-rate-input').setValue('42')],
      ['notes', (w) => w.get('.notes-stub').setValue('<p>calm</p>')],
      ['a rest state', (w) => w.findAll('.rest-btn')[0].trigger('click')],
    ])('asks before leaving a manual entry with %s', async (_, fill) => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.findAll('.mode-pill')[1].trigger('click');
      await fill(wrapper);
      router.back();
      await flushPromises();
      expect(dialog()).not.toBeNull();
    });

    it.each<[string, (wrapper: VueWrapper) => Promise<unknown>]>([
      ['nothing was counted', async () => {}],
      ['the manual entry is empty', (w) => w.findAll('.mode-pill')[1].trigger('click')],
      [
        'the manual rate was typed and cleared',
        async (w) => {
          await w.findAll('.mode-pill')[1].trigger('click');
          await w.get('.manual-rate-input').setValue('42');
          await w.get('.manual-rate-input').setValue('');
        },
      ],
    ])('leaves without asking when %s', async (_, prepare) => {
      const { wrapper } = await mountTracker({ from: petPage });
      await prepare(wrapper);
      router.back();
      await flushPromises();
      expect(dialog()).toBeNull();
      expect(router.currentRoute.value.name).toBe('pet');
    });

    it.each(['guided', 'manual'])('leaves without asking on Discard (%s)', async (mode) => {
      const { wrapper } = await mountTracker({ from: petPage });
      if (mode === 'manual') {
        await wrapper.findAll('.mode-pill')[1].trigger('click');
        await wrapper.get('.manual-rate-input').setValue('42');
      } else {
        await wrapper.get('.heart-btn').trigger('click');
        await vi.advanceTimersByTimeAsync(30_000);
      }
      await wrapper.get('.btn-discard').trigger('click');
      await flushPromises();
      expect(dialog()).toBeNull();
      expect(router.currentRoute.value.name).toBe('pet');
    });

    it('asks before the header back arrow leaves a count', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      await wrapper.get('.back-btn').trigger('click');
      await flushPromises();
      expect(dialog()).not.toBeNull();
      expect(router.currentRoute.value.name).toBe('tracker');
    });

    it('asks before the bottom nav leaves a count', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.get('.heart-btn').trigger('click');
      void router.push({ name: 'home' });
      await flushPromises();
      expect(dialog()).not.toBeNull();

      discardInDialog();
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('home');
      expect(wrapper.find('.tracker').exists()).toBe(false);
    });

    // A reminder tap opens that pet's tracker: the same route with another id.
    it('asks before a reminder opens another pet’s tracker', async () => {
      const { wrapper } = await mountTracker();
      usePetsStore().pets.push(makePet({ id: 'pet-2', name: 'Bo' }));
      await wrapper.get('.heart-btn').trigger('click');
      const other = { name: 'tracker', params: { id: 'pet-2' } } as const;

      const stay = router.push(other);
      await flushPromises();
      expect(dialog()).not.toBeNull();
      clickInDialog('.btn-cancel');
      await stay;
      expect(router.currentRoute.value.params.id).toBe(pet.id);
      expect(wrapper.get('.count-number').text()).toBe('1');

      void router.push(other);
      await flushPromises();
      discardInDialog();
      await flushPromises();
      expect(router.currentRoute.value.params.id).toBe('pet-2');
      expect(wrapper.get('.pet-name-label').text()).toBe('Bo');
    });

    it('keeps the count when a reminder opens this pet’s tracker', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.get('.heart-btn').trigger('click');
      // The same location: vue-router stops it as a duplicate before any guard runs.
      const result = await router.push({ name: 'tracker', params: { id: pet.id } });
      expect(isNavigationFailure(result, NavigationFailureType.duplicated)).toBe(true);
      expect(dialog()).toBeNull();
      expect(wrapper.get('.count-number').text()).toBe('1');
    });

    // E.g. two quick browser backs: one dialog, and its answer settles both navigations.
    it('answers a second navigation while asking with the same dialog', async () => {
      const { wrapper } = await mountTracker();
      await wrapper.get('.heart-btn').trigger('click');
      let settled = 0;
      void router.push({ name: 'home' }).then(() => settled++);
      void router.push({ name: 'settings' }).then(() => settled++);
      await flushPromises();
      expect(document.body.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);

      discardInDialog();
      await flushPromises();
      expect(settled).toBe(2);
      expect(router.currentRoute.value.name).toBe('settings');
    });

    it('stays when the Android back button closes the dialog', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      router.back();
      await flushPromises();

      expect(closeTopModal()).toBe(true);
      await flushPromises();
      expect(dialog()).toBeNull();
      expect(router.currentRoute.value.name).toBe('tracker');
      expect(router.options.history.location).toBe(`/pets/${pet.id}/track`);
    });

    it('closes the help when asking to leave, so it does not cover the dialog', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      await wrapper.get('.help-btn').trigger('click');
      const help = () => document.body.querySelector('[role="dialog"]');
      expect(help()).not.toBeNull();
      router.back();
      await flushPromises();
      expect(help()).toBeNull();
      expect(document.activeElement).toBe(dialog()?.querySelector('.btn-cancel'));

      clickInDialog('.btn-cancel');
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('tracker');
      expect(wrapper.get('.count-number').text()).toBe('1');
    });

    it('keeps focus in the dialog when the count ends behind it, then moves it to the result', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      const heart = wrapper.get<HTMLButtonElement>('.heart-btn');
      heart.element.focus();
      await heart.trigger('click');
      router.back();
      await flushPromises();
      const cancel = dialog()?.querySelector('.btn-cancel');
      expect(document.activeElement).toBe(cancel);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(document.activeElement).toBe(cancel);
      clickInDialog('.btn-cancel');
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('tracker');
      expect(document.activeElement).toBe(wrapper.get('.result').element);
    });

    it('keeps focus on the back arrow when the count ends behind the dialog and the user cancels', async () => {
      const { wrapper } = await mountTracker({ from: petPage });
      await wrapper.get('.heart-btn').trigger('click');
      const back = wrapper.get<HTMLButtonElement>('.back-btn');
      back.element.focus();
      await back.trigger('click');
      await flushPromises();
      expect(dialog()).not.toBeNull();

      await vi.advanceTimersByTimeAsync(30_000);
      clickInDialog('.btn-cancel');
      await flushPromises();
      expect(router.currentRoute.value.name).toBe('tracker');
      expect(wrapper.find('.result').exists()).toBe(true);
      expect(document.activeElement).toBe(back.element);
    });

    describe('while saving', () => {
      async function startSave(wrapper: VueWrapper, addReading: MockInstance) {
        const save = deferred<Reading>();
        addReading.mockImplementationOnce(() => save.promise);
        await wrapper.get('.heart-btn').trigger('click');
        await vi.advanceTimersByTimeAsync(30_000);
        await wrapper.get('.btn-save').trigger('click');
        void router.push({ name: 'settings' });
        await flushPromises();
        expect(dialog()).not.toBeNull();
        return save;
      }

      it('lets the user go once the save finishes', async () => {
        const { wrapper, addReading } = await mountTracker({ from: petPage });
        const save = await startSave(wrapper, addReading);
        save.resolve(makeReading());
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(router.currentRoute.value.name).toBe('settings');
      });

      it('keeps asking when the save fails', async () => {
        const { wrapper, addReading } = await mountTracker({ from: petPage });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const save = await startSave(wrapper, addReading);
        save.reject(new Error('quota exceeded'));
        await flushPromises();
        expect(dialog()).not.toBeNull();

        clickInDialog('.btn-cancel');
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('tracker');
        expect(wrapper.get('[role="alert"]').text()).toBe(en.tracker.saveError);
      });

      it('stays where the user went when they discard before it finishes', async () => {
        const { wrapper, addReading } = await mountTracker({ from: petPage });
        const save = await startSave(wrapper, addReading);
        discardInDialog();
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('settings');

        save.resolve(makeReading());
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('settings');
      });

      // E.g. the Settings page is still loading when the save lands: the tracker is still up.
      it('stays where the user went when the save finishes after Discard, before the page has gone', async () => {
        const { wrapper, addReading } = await mountTracker({ from: petPage });
        const settingsLoaded = deferred<void>();
        router.beforeEach(async (to) => {
          if (to.name === 'settings') await settingsLoaded.promise;
        });
        const save = await startSave(wrapper, addReading);
        discardInDialog();
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('tracker');

        save.resolve(makeReading());
        await flushPromises();
        settingsLoaded.resolve();
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('settings');
      });
    });
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
      const { wrapper, replace } = await mountTracker({ stored: failure });
      expect(wrapper.get('[role="alert"]').text()).toBe(
        'This could not be loaded. Go back and try again. Your data has not been deleted.',
      );
      expect(wrapper.find('.heart-btn').exists()).toBe(false);
      expect(wrapper.find('.mode-pill').exists()).toBe(false);
      expect(error).toHaveBeenCalledWith('Loading pet failed', failure);

      await wrapper.get('.back-btn').trigger('click');
      expect(replace).toHaveBeenCalledWith({ name: 'pet', params: { id: pet.id } });
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
