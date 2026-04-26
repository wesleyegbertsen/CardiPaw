export function useAudioBeep() {
  let ctx: AudioContext | null = null;

  function getContext(): AudioContext {
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext();
    }
    return ctx;
  }

  function playBeep(frequency = 880, duration = 0.5, volume = 0.3): void {
    const audioCtx = getContext();
    audioCtx.resume().then(() => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';

      const start = audioCtx.currentTime;
      gainNode.gain.setValueAtTime(volume, start);
      gainNode.gain.exponentialRampToValueAtTime(0.001, start + duration);

      oscillator.start(start);
      oscillator.stop(start + duration);
    });
  }

  function playDoneSound(): void {
    const audioCtx = getContext();
    audioCtx.resume().then(() => {
      const notes = [523, 659, 784]; // C5, E5, G5
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        const start = audioCtx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.start(start);
        osc.stop(start + 0.35);
      });
    });
  }

  return { playBeep, playDoneSound };
}
