import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { useAudioBeep } from './useAudioBeep';

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
  state: AudioContextState = 'running';
  currentTime = 10;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(() => Promise.resolve());
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

describe('useAudioBeep', () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resumes the audio context on init', () => {
    useAudioBeep().init();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledOnce();
  });

  it('reuses the context, and replaces it once closed', async () => {
    const audio = useAudioBeep();
    audio.init();
    audio.playBeep();
    expect(FakeAudioContext.instances).toHaveLength(1);

    FakeAudioContext.instances[0].state = 'closed';
    audio.playBeep();
    expect(FakeAudioContext.instances).toHaveLength(2);
    await flushPromises();
  });

  it('beeps at 880 Hz for half a second', async () => {
    useAudioBeep().playBeep();
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
    useAudioBeep().playDoneSound();
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
    useAudioBeep().playDoneSound();
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(0);
  });
});
