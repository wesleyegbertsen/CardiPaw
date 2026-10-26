import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ShareLinkModal from './ShareLinkModal.vue';
import * as codec from '../utils/shareCodec';
import { routes } from '../router';
import { Blank } from '../test/mountView';
import { createTestI18n } from '../test/i18n';
import { deferred } from '../test/deferred';
import { makePet, makeReading } from '../test/fixtures';

vi.mock('../utils/shareCodec', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/shareCodec')>();
  return { ...real, encodeShare: vi.fn(real.encodeShare) };
});

enableAutoUnmount(afterEach);

const readings = [
  makeReading({ id: 'march', date: '2024-03-15T12:00:00.000Z' }),
  makeReading({ id: 'feb', date: '2024-02-15T12:00:00.000Z' }),
];

const q = <T extends Element>(selector: string) => document.body.querySelector<T>(selector);
const copyButton = () => q<HTMLButtonElement>('.btn-primary')!;
const linkPreview = () => q<HTMLInputElement>('.link-preview')!;
const alert = () => q('[role="alert"]');
const monthBoxes = () => [...document.body.querySelectorAll<HTMLInputElement>('.month-row input')];

async function mountModal() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((r) => ({ ...r, component: Blank })),
  });
  const wrapper = mount(ShareLinkModal, {
    props: { pet: makePet(), readings },
    attachTo: document.body,
    global: { plugins: [router, createTestI18n()] },
  });
  // Encoding runs through real compression streams, which can outlast a few ticks.
  await vi.waitFor(() => expect(copyButton().disabled).toBe(false), { timeout: 5000 });
  return wrapper;
}

describe('ShareLinkModal', () => {
  beforeEach(() => {
    // Reset, not clear: a queued Once value left by a failed test must not leak.
    vi.mocked(codec.encodeShare).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a link to the share page that decodes back to the selection', async () => {
    await mountModal();
    const url = new URL(linkPreview().value);
    expect(url.pathname).toBe('/share');
    const d = url.searchParams.get('d')!;
    const payload = await codec.decodeShare(d);
    expect(payload.readings).toHaveLength(2);
    expect(linkPreview().getAttribute('aria-label')).toBe('Share');
  });

  it('disables Copy while the new selection is being encoded', async () => {
    await mountModal();
    const held = deferred<string>();
    vi.mocked(codec.encodeShare).mockImplementationOnce(() => held.promise);
    monthBoxes()[0].click();
    await flushPromises();
    expect(copyButton().disabled).toBe(true);

    held.resolve('abc');
    await flushPromises();
    expect(linkPreview().value).toContain('d=abc');
    expect(copyButton().disabled).toBe(false);
  });

  it('shows an alert and no link when encoding fails', async () => {
    await mountModal();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(codec.encodeShare).mockRejectedValueOnce(new Error('no CompressionStream'));
    monthBoxes()[0].click();
    await flushPromises();
    expect(alert()?.textContent?.trim()).toBe(
      'The share link could not be created. Please try again.',
    );
    // Styled as an error, not as the long-link warning.
    expect(alert()?.className).toBe('encode-error');
    expect(linkPreview().value).toBe('');
    expect(copyButton().disabled).toBe(true);
    expect(error).toHaveBeenCalled();

    monthBoxes()[0].click();
    await vi.waitFor(() => expect(copyButton().disabled).toBe(false), { timeout: 5000 });
    expect(alert()).toBeNull();
  });

  it('ignores a result that a newer selection superseded', async () => {
    await mountModal();
    const first = deferred<string>();
    const second = deferred<string>();
    vi.mocked(codec.encodeShare)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    monthBoxes()[0].click();
    await flushPromises();
    monthBoxes()[0].click();
    await flushPromises();

    second.resolve('newer');
    await flushPromises();
    first.resolve('older');
    await flushPromises();
    expect(linkPreview().value).toContain('d=newer');
  });

  it('ignores a failure that a newer selection superseded', async () => {
    await mountModal();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = deferred<string>();
    const second = deferred<string>();
    vi.mocked(codec.encodeShare)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    monthBoxes()[0].click();
    await flushPromises();
    monthBoxes()[0].click();
    await flushPromises();

    second.resolve('newer');
    await flushPromises();
    first.reject(new Error('no CompressionStream'));
    await flushPromises();
    expect(alert()).toBeNull();
    expect(linkPreview().value).toContain('d=newer');
    expect(copyButton().disabled).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it('shows Copied for two seconds after copying', async () => {
    await mountModal();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    copyButton().click();
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(linkPreview().value);
    expect(copyButton().textContent?.trim()).toBe('Copied!');

    vi.advanceTimersByTime(1999);
    await flushPromises();
    expect(copyButton().textContent?.trim()).toBe('Copied!');
    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(copyButton().textContent?.trim()).toBe('Copy link');
  });

  it('clears the Copied timer when closed', async () => {
    const wrapper = await mountModal();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    copyButton().click();
    await flushPromises();
    clear.mockClear();
    wrapper.unmount();
    expect(clear).toHaveBeenCalled();
  });

  describe('native share', () => {
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'share');
    });

    it('is offered only when the browser supports it', async () => {
      await mountModal();
      expect(q('.btn-secondary')).toBeNull();
    });

    it('shares the link', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', { value: share, configurable: true });
      await mountModal();
      q<HTMLButtonElement>('.btn-secondary')!.click();
      await flushPromises();
      expect(share).toHaveBeenCalledWith({
        title: 'Ace — CardiPaw snapshot',
        url: linkPreview().value,
      });
    });
  });

  it('warns when the link is over 8000 characters', async () => {
    vi.mocked(codec.encodeShare).mockResolvedValueOnce('x'.repeat(8000));
    await mountModal();
    expect(q('.length-warning')?.textContent).toContain('This link is very long');
  });

  it('does not warn about a short link', async () => {
    await mountModal();
    expect(q('.length-warning')).toBeNull();
  });
});
