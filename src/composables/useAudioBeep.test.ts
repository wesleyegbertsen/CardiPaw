import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';

// Records what would be played; Web Audio does not exist in node.
class FakeOscillator {
  frequency = { value: 0 };
  type = '';
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain {
  gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  connect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 10;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

// The context lives in the module, shared by every caller: each test loads a fresh copy.
let useAudioBeep: typeof import('./useAudioBeep').useAudioBeep;

// Opens the tracker: calls the composable in an effect scope, as a component's setup would.
// close() is the component unmounting.
function open() {
  const scope = effectScope();
  const audio = scope.run(() => useAudioBeep())!;
  return { audio, close: () => scope.stop() };
}

describe('useAudioBeep', () => {
  beforeEach(async () => {
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    // Only the suspend delay's timer; the rest stay real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.resetModules();
    ({ useAudioBeep } = await import('./useAudioBeep'));
  });
  afterEach(() => vi.useRealTimers());

  it('resumes the audio context on init', () => {
    open().audio.init();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledOnce();
  });

  it('reuses the context, and replaces it once closed', async () => {
    const { audio } = open();
    audio.init();
    audio.playBeep();
    expect(FakeAudioContext.instances).toHaveLength(1);

    FakeAudioContext.instances[0].state = 'closed';
    audio.playBeep();
    expect(FakeAudioContext.instances).toHaveLength(2);
    await flushPromises();
  });

  it('beeps at 880 Hz for half a second', async () => {
    open().audio.playBeep();
    await flushPromises();
    const [ctx] = FakeAudioContext.instances;
    const [osc] = ctx.oscillators;
    const [gain] = ctx.gains;
    expect(osc.frequency.value).toBe(880);
    expect(osc.type).toBe('sine');
    expect(osc.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 10);
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.001, 10.5);
    expect(osc.start).toHaveBeenCalledWith(10);
    expect(osc.stop).toHaveBeenCalledWith(10.5);
  });

  it('plays a rising three-note chord when done', async () => {
    open().audio.playDoneSound();
    await flushPromises();
    const [ctx] = FakeAudioContext.instances;
    expect(ctx.oscillators.map((o) => o.frequency.value)).toEqual([523, 659, 784]);
    const starts = ctx.oscillators.map((o) => o.start.mock.calls[0][0] - 10);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(0.18);
    expect(starts[2]).toBeCloseTo(0.36);
    for (const osc of ctx.oscillators) {
      expect(osc.stop.mock.calls[0][0] - osc.start.mock.calls[0][0]).toBeCloseTo(0.35);
    }
  });

  it('plays nothing until the context has resumed', () => {
    open().audio.playDoneSound();
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(0);
  });

  describe('between visits', () => {
    it('keeps one context across tracker visits', async () => {
      for (let i = 0; i < 5; i++) {
        const tracker = open();
        tracker.audio.init();
        await flushPromises();
        tracker.close();
        vi.advanceTimersByTime(1000);
      }
      const [ctx] = FakeAudioContext.instances;
      expect(FakeAudioContext.instances).toHaveLength(1);
      expect(ctx.resume).toHaveBeenCalledTimes(5);
      expect(ctx.suspend).toHaveBeenCalledTimes(5);
    });

    it('suspends the context a moment after the tracker closes, once the chime is over', async () => {
      const tracker = open();
      tracker.audio.init();
      await flushPromises();
      tracker.audio.playDoneSound();
      await flushPromises();
      tracker.close();
      const [ctx] = FakeAudioContext.instances;
      vi.advanceTimersByTime(900); // the chime lasts 0.71 s
      expect(ctx.suspend).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(ctx.suspend).toHaveBeenCalledOnce();
      expect(ctx.state).toBe('suspended');
    });

    it('keeps the context running when the tracker opens again within that moment', async () => {
      const first = open();
      first.audio.init();
      await flushPromises();
      first.close();
      vi.advanceTimersByTime(500);
      const second = open();
      vi.advanceTimersByTime(2000);
      const [ctx] = FakeAudioContext.instances;
      expect(ctx.suspend).not.toHaveBeenCalled();
      second.close();
      vi.advanceTimersByTime(1000);
      expect(ctx.suspend).toHaveBeenCalledOnce();
    });

    it('keeps the context running while another caller remains', async () => {
      const a = open();
      const b = open();
      a.audio.init();
      await flushPromises();
      a.close();
      vi.advanceTimersByTime(2000);
      const [ctx] = FakeAudioContext.instances;
      expect(ctx.suspend).not.toHaveBeenCalled();
      b.close();
      vi.advanceTimersByTime(1000);
      expect(ctx.suspend).toHaveBeenCalledOnce();
    });

    it('leaves a context alone that is not running', async () => {
      const tracker = open();
      tracker.audio.init();
      await flushPromises();
      FakeAudioContext.instances[0].state = 'suspended'; // e.g. the browser did, with the app in the background
      tracker.close();
      vi.advanceTimersByTime(1000);
      expect(FakeAudioContext.instances[0].suspend).not.toHaveBeenCalled();
    });

    it('logs a suspend that fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tracker = open();
      tracker.audio.init();
      await flushPromises();
      const error = new DOMException('Context is gone', 'InvalidStateError');
      FakeAudioContext.instances[0].suspend.mockRejectedValueOnce(error);
      tracker.close();
      vi.advanceTimersByTime(1000);
      await flushPromises();
      expect(warn).toHaveBeenCalledExactlyOnceWith('Suspending audio failed', error);
    });
  });

  describe('when sound fails', () => {
    it('keeps going when the browser refuses to create a context', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = new DOMException('Too many contexts', 'NotSupportedError');
      vi.stubGlobal(
        'AudioContext',
        class {
          constructor() {
            throw error;
          }
        },
      );
      const tracker = open();
      expect(() => {
        tracker.audio.init();
        tracker.audio.playBeep();
      }).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith('Playing a sound failed', error);
      tracker.close();
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow(); // no context to suspend

      // A later visit tries again.
      vi.stubGlobal('AudioContext', FakeAudioContext);
      open().audio.init();
      expect(FakeAudioContext.instances).toHaveLength(1);
    });

    it('logs a resume that fails, and plays nothing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { audio } = open();
      audio.init();
      await flushPromises();
      const [ctx] = FakeAudioContext.instances;
      const error = new DOMException('Context is gone', 'InvalidStateError');
      ctx.resume.mockRejectedValueOnce(error);
      audio.playBeep();
      await flushPromises();
      expect(warn).toHaveBeenCalledExactlyOnceWith('Playing a sound failed', error);
      expect(ctx.oscillators).toHaveLength(0);
    });
  });
});
