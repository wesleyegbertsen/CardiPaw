import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CameraCapture from './CameraCapture.vue';
import { createTestI18n } from '../test/i18n';
import { makePet } from '../test/fixtures';
import type { Pet } from '../types';
import type { CameraError, CameraPhase, CameraVerdict } from '../composables/useCameraBreath';
import type { CaptureReason } from '../camera/capture';

// The composable's own tests cover the camera; here its state is flipped by hand.
const cam = vi.hoisted(() => ({
  phase: undefined as unknown as { value: CameraPhase },
  error: undefined as unknown as { value: CameraError | null },
  placement: undefined as unknown as {
    value: { tooDark: boolean; moving: boolean; slow: boolean; steady: boolean };
  },
  hints: undefined as unknown as {
    value: { shake: boolean; fewTracks: boolean; tooDark: boolean };
  },
  elapsedSeconds: undefined as unknown as { value: number },
  targetSeconds: undefined as unknown as { value: 30 | 60 },
  extending: undefined as unknown as { value: boolean },
  verdict: undefined as unknown as { value: CameraVerdict | null },
  screenLockRefused: undefined as unknown as { value: boolean },
  open: vi.fn(),
  begin: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('../composables/useCameraBreath', async () => {
  const { ref } = await import('vue');
  cam.phase = ref('idle');
  cam.error = ref(null);
  cam.placement = ref({ tooDark: false, moving: false, slow: false, steady: false });
  cam.hints = ref({ shake: false, fewTracks: false, tooDark: false });
  cam.elapsedSeconds = ref(0);
  cam.targetSeconds = ref(30);
  cam.extending = ref(false);
  cam.verdict = ref(null);
  cam.screenLockRefused = ref(false);
  return { useCameraBreath: () => cam };
});

function mountCapture(props: { pet?: Pet; autoOpen?: boolean; landscape?: boolean } = {}) {
  return mount(CameraCapture, {
    props: { pet: makePet({ species: 'cat' }), ...props },
    attachTo: document.body,
    global: { plugins: [createTestI18n()] },
  });
}

async function setPhase(phase: CameraPhase, error: CameraError | null = null) {
  cam.phase.value = phase;
  cam.error.value = error;
  await flushPromises();
}

const accepted: CameraVerdict = {
  seconds: 30,
  accepted: true,
  rate: 24,
  interval: [23, 25],
  reasons: [],
  estimate: null,
  deliveredFps: 29.97,
};
const abstain = (reasons: CaptureReason[]): CameraVerdict => ({
  seconds: 60,
  accepted: false,
  rate: null,
  interval: null,
  reasons,
  estimate: null,
  deliveredFps: 29.97,
});

async function finishWith(verdict: CameraVerdict) {
  cam.verdict.value = verdict;
  await setPhase('done');
}

describe('CameraCapture', () => {
  beforeEach(() => {
    cam.phase.value = 'idle';
    cam.error.value = null;
    cam.placement.value = { tooDark: false, moving: false, slow: false, steady: false };
    cam.hints.value = { shake: false, fewTracks: false, tooDark: false };
    cam.elapsedSeconds.value = 0;
    cam.targetSeconds.value = 30;
    cam.extending.value = false;
    cam.verdict.value = null;
    cam.screenLockRefused.value = false;
    cam.open.mockReset();
    cam.begin.mockReset();
    cam.cancel.mockReset();
  });

  it('explains the feature, asks for the camera on Allow and offers tapping instead', async () => {
    const wrapper = mountCapture();
    expect(wrapper.text()).toContain('Count breaths with the camera');
    expect(wrapper.text()).toContain('Prop your phone up so the camera sees');
    expect(wrapper.text()).toContain('The video is analysed on this phone only.');
    expect(wrapper.get('.light-note').text()).toBe('Works best in a well-lit room.');
    expect(wrapper.get('.experimental-chip').text()).toBe('Experimental');
    expect(wrapper.get('video').attributes('aria-hidden')).toBe('true');
    expect(cam.open).not.toHaveBeenCalled();

    await wrapper.get('.btn-save').trigger('click');
    expect(cam.open).toHaveBeenCalledOnce();
    expect(wrapper.get('.btn-save').text()).toBe('Allow camera');
    await wrapper.get('.btn-discard').trigger('click');
    expect(wrapper.emitted('tapInstead')).toHaveLength(1);
  });

  it('opens the camera on mount when asked to', async () => {
    mountCapture({ autoOpen: true });
    await flushPromises();
    expect(cam.open).toHaveBeenCalledOnce();
  });

  it('shows a status while the permission prompt is open', async () => {
    const wrapper = mountCapture();
    await setPhase('requesting');
    expect(wrapper.get('[role="status"]').text()).toBe('Waiting for camera access…');
    expect(wrapper.find('.spinner').exists()).toBe(true);
    expect(wrapper.find('.btn-save').exists()).toBe(false);
  });

  it.each([
    ['denied', 'Camera access was refused.', true],
    ['no-camera', 'No camera was found on this device.', true],
    ['busy', 'The camera is in use by another app.', true],
    ['unsupported', "This browser can't use the camera here.", false],
    ['failed', 'Something went wrong with the camera.', true],
    ['interrupted', 'The count was interrupted', true],
  ] as const)('explains the %s error', async (error, text, retry) => {
    const wrapper = mountCapture();
    await setPhase('error', error);
    expect(wrapper.get('[role="alert"]').text()).toContain(text);
    expect(wrapper.find('.btn-retry').exists()).toBe(retry);
    if (retry) {
      expect(wrapper.get('.btn-retry').text()).toBe('Try again');
      await wrapper.get('.btn-retry').trigger('click');
      expect(cam.open).toHaveBeenCalledOnce();
    }
    await wrapper.get('.btn-discard').trigger('click');
    expect(wrapper.emitted('tapInstead')).toHaveLength(1);
  });

  describe('focus', () => {
    it('moves to the instruction when placing starts', async () => {
      const wrapper = mountCapture();
      await setPhase('placing');
      expect(document.activeElement).toBe(wrapper.get('.body-text').element);
    });

    it('moves to the alert on an error', async () => {
      const wrapper = mountCapture();
      await setPhase('error', 'busy');
      expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element);
    });

    it('moves to the alert when the count abstains', async () => {
      const wrapper = mountCapture();
      await setPhase('capturing');
      await finishWith(abstain(['shake']));
      expect(document.activeElement).toBe(wrapper.get('[role="alert"]').element);
    });
  });

  describe('placing', () => {
    it('shows the preview with the box the tracker reads, and Start once steady', async () => {
      const wrapper = mountCapture();
      expect(wrapper.get<HTMLElement>('.preview').element.style.display).toBe('none');
      await setPhase('placing');
      expect(wrapper.get<HTMLElement>('.preview').element.style.display).toBe('');
      const box = wrapper.get<HTMLElement>('.roi-box').element.style;
      expect({ left: box.left, top: box.top, width: box.width, height: box.height }).toEqual({
        left: '19.79%',
        top: '27.78%',
        width: '60.42%',
        height: '50.00%',
      });
      expect(wrapper.text()).toContain('Fit the chest or belly inside the box');
      const start = wrapper.get<HTMLButtonElement>('.btn-save');
      expect(start.text()).toBe('Start');
      expect(start.element.disabled).toBe(true);
      await start.trigger('click');
      expect(cam.begin).not.toHaveBeenCalled();

      cam.placement.value = { tooDark: false, moving: false, slow: false, steady: true };
      await flushPromises();
      expect(start.element.disabled).toBe(false);
      await start.trigger('click');
      expect(cam.begin).toHaveBeenCalledOnce();
    });

    it('says it is checking the picture while no other hint applies', async () => {
      const wrapper = mountCapture();
      await setPhase('placing');
      const hint = wrapper.get('.placement-hint');
      expect(hint.text()).toBe('Checking the picture… hold still.');
      expect(hint.classes()).toContain('checking');
    });

    it.each([
      [
        'too dark',
        { tooDark: true, moving: true, slow: true, steady: false },
        'Too dark: turn on a light.',
      ],
      [
        'moving',
        { tooDark: false, moving: true, slow: true, steady: false },
        "The phone is moving: prop it up and don't touch it.",
      ],
      [
        'steady',
        { tooDark: false, moving: false, slow: false, steady: true },
        'Steady. Start when your pet is settled.',
      ],
      [
        'slow',
        { tooDark: false, moving: false, slow: true, steady: false },
        'More light needed: the camera slows down in dim light.',
      ],
    ])('hints %s', async (_label, placement, text) => {
      const wrapper = mountCapture();
      await setPhase('placing');
      cam.placement.value = placement;
      await flushPromises();
      expect(wrapper.get('.placement-hint').text()).toBe(text);
    });

    it('keeps Start off and warns while the camera runs slow', async () => {
      const wrapper = mountCapture();
      await setPhase('placing');
      cam.placement.value = { tooDark: false, moving: false, slow: true, steady: false };
      await flushPromises();
      const hint = wrapper.get('.placement-hint');
      expect(hint.text()).toBe('More light needed: the camera slows down in dim light.');
      expect(hint.classes()).not.toContain('checking');
      expect(hint.classes()).not.toContain('ready');
      expect(wrapper.get<HTMLButtonElement>('.btn-save').element.disabled).toBe(true);
    });

    it('offers a named Count along switch with its hint once on', async () => {
      const wrapper = mountCapture();
      await setPhase('placing');
      const toggle = wrapper.get('[role="switch"]');
      expect(document.getElementById(toggle.attributes('aria-labelledby')!)?.textContent).toBe(
        'Count along',
      );
      expect(toggle.attributes('aria-describedby')).toBeUndefined();
      await toggle.trigger('click');
      const hint = document.getElementById(toggle.attributes('aria-describedby')!);
      expect(hint?.textContent).toContain('Tap the heart for each breath you see');
    });
  });

  describe('capturing', () => {
    it('counts up on the ring and announces every ten seconds', async () => {
      const wrapper = mountCapture();
      await setPhase('capturing');
      expect(wrapper.text()).toContain('Watching…');
      const live = wrapper.get('[aria-live="polite"]');
      expect(live.text()).toBe('');
      cam.elapsedSeconds.value = 12;
      await flushPromises();
      expect(Number(wrapper.get('.ring-progress').attributes('stroke-dashoffset'))).toBeCloseTo(
        339.3 * (1 - 12 / 30),
      );
      expect(wrapper.get('.timer-number').text()).toBe('12');
      expect(live.text()).toBe('10 seconds watched');
      cam.elapsedSeconds.value = 20;
      await flushPromises();
      expect(live.text()).toBe('20 seconds watched');
      cam.targetSeconds.value = 60;
      cam.extending.value = true;
      await flushPromises();
      expect(Number(wrapper.get('.ring-progress').attributes('stroke-dashoffset'))).toBeCloseTo(
        339.3 * (1 - 20 / 60),
      );
      expect(wrapper.get('.hint').text()).toBe('Watching 30 more seconds for a surer count.');
      expect(wrapper.find('.heart-btn').exists()).toBe(false);
    });

    it('keeps the box on the preview while watching, thinner', async () => {
      const wrapper = mountCapture();
      await setPhase('placing');
      expect(wrapper.get('.roi-box').classes()).not.toContain('thin');
      await setPhase('capturing');
      expect(wrapper.get('.roi-box').classes()).toContain('thin');
    });

    it('announces the extension and the screen-lock request once each', async () => {
      const wrapper = mountCapture();
      await setPhase('capturing');
      const live = wrapper.get('[aria-live="polite"]');
      cam.screenLockRefused.value = true;
      await flushPromises();
      expect(live.text()).toBe('Keep the screen on until the count ends.');
      cam.elapsedSeconds.value = 10;
      await flushPromises();
      expect(live.text()).toBe('10 seconds watched');
      cam.elapsedSeconds.value = 30;
      await flushPromises();
      cam.targetSeconds.value = 60;
      cam.extending.value = true;
      await flushPromises();
      expect(live.text()).toBe('Watching 30 more seconds for a surer count.');
      cam.elapsedSeconds.value = 35;
      await flushPromises();
      expect(live.text()).toBe('Watching 30 more seconds for a surer count.'); // nothing new to say yet
      cam.elapsedSeconds.value = 40;
      await flushPromises();
      expect(live.text()).toBe('40 seconds watched');
    });

    it.each([
      ['shake', { shake: true, fewTracks: true, tooDark: true }, 'Keep the phone still.'],
      [
        'few tracks',
        { shake: false, fewTracks: true, tooDark: true },
        'Hard to see detail: more light, or move closer.',
      ],
      ['dark', { shake: false, fewTracks: false, tooDark: true }, 'Getting dark: turn on a light.'],
    ])('hints %s while watching', async (_label, hints, text) => {
      const wrapper = mountCapture();
      await setPhase('capturing');
      expect(wrapper.find('.live-hint').exists()).toBe(false);
      cam.hints.value = hints;
      await flushPromises();
      expect(wrapper.get('.live-hint').text()).toBe(text);
    });

    it('asks to keep the screen on when the lock was refused', async () => {
      const wrapper = mountCapture();
      await setPhase('capturing');
      expect(wrapper.text()).not.toContain('Keep the screen on');
      cam.screenLockRefused.value = true;
      await flushPromises();
      expect(wrapper.text()).toContain('Keep the screen on until the count ends.');
    });

    it('reports busy while placing and capturing only', async () => {
      const wrapper = mountCapture();
      expect(wrapper.emitted('busy')).toEqual([[false]]);
      await setPhase('placing');
      expect(wrapper.emitted('busy')).toEqual([[false], [true]]);
      await setPhase('capturing');
      expect(wrapper.emitted('busy')).toEqual([[false], [true]]);
      await finishWith(accepted);
      expect(wrapper.emitted('busy')).toEqual([[false], [true], [false]]);
    });

    // The tracker asks before leaving a running count; placing has nothing to lose yet.
    it('reports capturing while capturing only', async () => {
      const wrapper = mountCapture();
      expect(wrapper.emitted('capturing')).toEqual([[false]]);
      await setPhase('placing');
      expect(wrapper.emitted('capturing')).toEqual([[false]]);
      await setPhase('capturing');
      expect(wrapper.emitted('capturing')).toEqual([[false], [true]]);
      await setPhase('error', 'interrupted');
      expect(wrapper.emitted('capturing')).toEqual([[false], [true], [false]]);
    });
  });

  describe('result', () => {
    it('emits an accepted verdict once, without taps, and renders nothing itself', async () => {
      const wrapper = mountCapture();
      await setPhase('capturing');
      await finishWith(accepted);
      expect(wrapper.emitted('result')).toEqual([
        [{ rate: 24, seconds: 30, interval: [23, 25], taps: null }],
      ]);
      expect(wrapper.findAll('button')).toHaveLength(0);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('passes the owner’s taps along from three taps up, reset by each Start', async () => {
      const wrapper = mountCapture();
      await setPhase('placing');
      await wrapper.get('[role="switch"]').trigger('click');
      await setPhase('capturing');
      const heart = wrapper.get('.heart-btn');
      await heart.trigger('click');
      await heart.trigger('click');
      expect(wrapper.text()).toContain('2 breaths tapped');
      await heart.trigger('click');
      expect(wrapper.text()).toContain('3 breaths tapped');
      await finishWith(accepted);
      expect(wrapper.emitted('result')).toEqual([
        [{ rate: 24, seconds: 30, interval: [23, 25], taps: 3 }],
      ]);

      cam.placement.value = { tooDark: false, moving: false, slow: false, steady: true };
      await setPhase('placing');
      await wrapper.get('.btn-save').trigger('click'); // Start resets the taps
      await setPhase('capturing');
      await wrapper.get('.heart-btn').trigger('click');
      expect(wrapper.text()).toContain('1 breath tapped');
      await finishWith({ ...accepted, seconds: 60 });
      expect(wrapper.emitted('result')).toHaveLength(2);
      expect(wrapper.emitted('result')![1]).toEqual([
        { rate: 24, seconds: 60, interval: [23, 25], taps: null },
      ]);
    });
  });

  it('drops the taps below three', async () => {
    const wrapper = mountCapture();
    await setPhase('placing');
    await wrapper.get('[role="switch"]').trigger('click');
    await setPhase('capturing');
    await wrapper.get('.heart-btn').trigger('click');
    await wrapper.get('.heart-btn').trigger('click');
    await finishWith(accepted);
    expect(wrapper.emitted('result')).toEqual([
      [{ rate: 24, seconds: 30, interval: [23, 25], taps: null }],
    ]);
  });

  describe('abstained', () => {
    it.each([
      [['shake'], 'The phone moved.'],
      [['few-tracks'], 'Not enough detail to follow.'],
      [['frame-rate'], 'The camera ran too slowly here'],
      [['fast-motion'], 'Too much quick movement'],
      [['twitch'], 'Your pet moved during the count.'],
      [['irregular'], 'The breathing looked irregular.'],
      [['estimators-disagree'], 'The breathing looked irregular.'],
      [['no-signal'], 'No steady breathing movement was seen.'],
      [['weak-periodicity'], 'No steady breathing movement was seen.'],
      [['too-short'], 'The count was cut short.'],
      [['low-quality'], "The movement wasn't clear enough for a count."],
      [['no-signal', 'shake'], 'The phone moved.'], // shake explains everything after it
      [['low-quality', 'frame-rate', 'few-tracks'], 'Not enough detail to follow.'],
    ] as [CaptureReason[], string][])('explains %j', async (reasons, text) => {
      const wrapper = mountCapture();
      await setPhase('capturing');
      await finishWith(abstain(reasons));
      const alert = wrapper.get('[role="alert"]');
      expect(alert.text()).toContain('No count this time');
      expect(alert.text()).toContain(text);
      expect(alert.text()).not.toContain('Large dogs');
      expect(wrapper.emitted('result')).toBeUndefined();
      expect(wrapper.get('.btn-retry').text()).toBe('Measure again');
      await wrapper.get('.btn-retry').trigger('click');
      expect(cam.open).toHaveBeenCalledOnce();
      await wrapper.get('.btn-discard').trigger('click');
      expect(wrapper.emitted('tapInstead')).toHaveLength(1);
    });

    it('adds the slow-breathing note for a dog', async () => {
      const wrapper = mountCapture({ pet: makePet({ species: 'dog' }) });
      await setPhase('capturing');
      await finishWith(abstain(['no-signal']));
      expect(wrapper.get('[role="alert"]').text()).toContain(
        'Large dogs often breathe fewer than 9 times a minute',
      );
    });
  });

  // The tracker lays the two regions out side by side when the phone is sideways.
  describe('regions', () => {
    const region = (wrapper: ReturnType<typeof mountCapture>, name: 'preview' | 'panel') =>
      wrapper.get(`.camera-capture > .capture-${name}`);

    it('keeps the video in the preview region and the steps in the panel region', async () => {
      const wrapper = mountCapture();
      expect(wrapper.classes()).not.toContain('landscape');
      expect(region(wrapper, 'preview').find('video').exists()).toBe(true);
      expect(region(wrapper, 'panel').text()).toContain('Count breaths with the camera');
      expect(region(wrapper, 'panel').find('.experimental-chip').exists()).toBe(true);
      await setPhase('placing');
      expect(region(wrapper, 'preview').find('.roi-box').exists()).toBe(true);
      expect(region(wrapper, 'panel').get('.btn-save').text()).toBe('Start');
    });

    it('shows no placeholder upright: the steps take the whole screen there', async () => {
      const wrapper = mountCapture();
      expect(wrapper.find('.preview-placeholder').exists()).toBe(false);
      await setPhase('error', 'denied');
      expect(wrapper.find('.preview-placeholder').exists()).toBe(false);
    });

    it.each<[string, () => Promise<unknown>]>([
      ['the explanation', async () => {}],
      ['the permission prompt', () => setPhase('requesting')],
      ['an error', () => setPhase('error', 'interrupted')],
      [
        'an abstain',
        async () => {
          await setPhase('capturing');
          await finishWith(abstain(['shake']));
        },
      ],
    ])('sideways, shows a placeholder instead of the preview on %s', async (_, prepare) => {
      const wrapper = mountCapture({ landscape: true });
      await prepare();
      expect(wrapper.classes()).toContain('landscape');
      const preview = region(wrapper, 'preview');
      expect(preview.get('.preview-placeholder').attributes('aria-hidden')).toBe('true');
      expect(preview.get<HTMLElement>('.preview').element.style.display).toBe('none');
    });

    it.each<CameraPhase>(['placing', 'capturing'])(
      'sideways, shows the live preview while %s, without the placeholder',
      async (phase) => {
        const wrapper = mountCapture({ landscape: true });
        await setPhase(phase);
        const preview = region(wrapper, 'preview');
        expect(preview.get<HTMLElement>('.preview').element.style.display).toBe('');
        expect(preview.find('.roi-box').exists()).toBe(true);
        expect(preview.find('.preview-placeholder').exists()).toBe(false);
      },
    );

    it('sideways, keeps the steps and their buttons in the panel', async () => {
      const wrapper = mountCapture({ landscape: true });
      await setPhase('placing');
      expect(region(wrapper, 'panel').text()).toContain('Fit the chest or belly inside the box');
      expect(region(wrapper, 'panel').find('.btn-save').exists()).toBe(true);
      await setPhase('capturing');
      expect(region(wrapper, 'panel').find('.timer-ring').exists()).toBe(true);
    });
  });
});
