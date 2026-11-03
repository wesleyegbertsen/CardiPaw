import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useWakeLock } from './useWakeLock';
import { deferred } from '../test/deferred';

function makeSentinel() {
  const sentinel = Object.assign(new EventTarget(), {
    released: false,
    type: 'screen' as const,
    onrelease: null,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
  });
  return sentinel;
}
type FakeSentinel = ReturnType<typeof makeSentinel>;

let scope: EffectScope;
let request: ReturnType<typeof vi.fn<() => Promise<FakeSentinel>>>;
let sentinels: FakeSentinel[];
let visibility: DocumentVisibilityState;

// Grants every request with a new sentinel, unless a test passes its own implementation.
function stubWakeLock(impl?: () => Promise<FakeSentinel>) {
  request = vi.fn(
    impl ??
      (async () => {
        const s = makeSentinel();
        sentinels.push(s);
        return s;
      }),
  );
  // happy-dom has no Screen Wake Lock API; unstubGlobals restores navigator after each test.
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { wakeLock: { request } }));
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

// Called in an effect scope, as a component's setup would.
function use() {
  return scope.run(() => useWakeLock())!;
}

describe('useWakeLock', () => {
  beforeEach(() => {
    scope = effectScope();
    sentinels = [];
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    stubWakeLock();
  });
  afterEach(() => scope.stop());

  it('does nothing where the API is missing', () => {
    vi.unstubAllGlobals(); // back to happy-dom's navigator, which has no wakeLock
    expect('wakeLock' in navigator).toBe(false);
    const lock = use();
    expect(() => {
      lock.acquire();
      lock.release();
    }).not.toThrow();
  });

  it('keeps the screen on until released', async () => {
    const lock = use();
    lock.acquire();
    await flushPromises();
    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    expect(sentinels[0].release).not.toHaveBeenCalled();
    lock.release();
    expect(sentinels[0].release).toHaveBeenCalledOnce();
  });

  it('requests once while a request is pending', async () => {
    const lock = use();
    lock.acquire();
    lock.acquire();
    setVisibility('visible');
    await flushPromises();
    expect(request).toHaveBeenCalledOnce();
  });

  it('lets go of a lock granted after it was released', async () => {
    const pending = deferred<FakeSentinel>();
    stubWakeLock(() => pending.promise);
    const lock = use();
    lock.acquire();
    lock.release();
    const late = makeSentinel();
    pending.resolve(late);
    await flushPromises();
    expect(late.release).toHaveBeenCalledOnce();
  });

  it('keeps a pending lock when released and acquired again before it is granted', async () => {
    const pending = deferred<FakeSentinel>();
    stubWakeLock(() => pending.promise);
    const lock = use();
    lock.acquire();
    lock.release();
    lock.acquire();
    const granted = makeSentinel();
    pending.resolve(granted);
    await flushPromises();
    expect(request).toHaveBeenCalledOnce();
    expect(granted.release).not.toHaveBeenCalled();
    lock.release();
    expect(granted.release).toHaveBeenCalledOnce();
  });

  it('takes the lock again when the page is shown after the browser dropped it', async () => {
    const lock = use();
    lock.acquire();
    await flushPromises();
    sentinels[0].released = true; // the browser drops it as the page is hidden
    setVisibility('hidden');
    await flushPromises();
    expect(request).toHaveBeenCalledOnce(); // a hidden page would be refused
    setVisibility('visible');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    lock.release();
    expect(sentinels[1].release).toHaveBeenCalledOnce();
  });

  it('does not request again while the lock still holds', async () => {
    const lock = use();
    lock.acquire();
    await flushPromises();
    setVisibility('visible');
    await flushPromises();
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not take the lock on return once released', async () => {
    const lock = use();
    lock.acquire();
    await flushPromises();
    lock.release();
    setVisibility('hidden');
    setVisibility('visible');
    await flushPromises();
    expect(request).toHaveBeenCalledOnce();
  });

  it('logs a refused request and tries again on return', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refusal = new DOMException('Battery saver is on', 'NotAllowedError');
    request.mockRejectedValueOnce(refusal);
    const lock = use();
    lock.acquire();
    await flushPromises();
    expect(warn).toHaveBeenCalledExactlyOnceWith('Keeping the screen on failed', refusal);
    setVisibility('visible');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    lock.release();
    expect(sentinels[0].release).toHaveBeenCalledOnce();
  });

  it('releases when its component goes away, and stops listening', async () => {
    const lock = use();
    lock.acquire();
    await flushPromises();
    scope.stop();
    expect(sentinels[0].release).toHaveBeenCalledOnce();
    setVisibility('visible');
    await flushPromises();
    expect(request).toHaveBeenCalledOnce();
  });
});
