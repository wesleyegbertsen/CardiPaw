import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import PdfExportModal from './PdfExportModal.vue';
import { usePdfExport } from '../composables/usePdfExport';
import { createTestI18n } from '../test/i18n';
import { makePet, makeReading } from '../test/fixtures';

// One shared state, so the test sees what the modal sees.
vi.mock('../composables/usePdfExport', async () => {
  const { ref } = await import('vue');
  const state = { isGenerating: ref(false), generatePdf: vi.fn() };
  return { usePdfExport: () => state, preloadPdfLibrary: vi.fn() };
});

const { isGenerating, generatePdf } = usePdfExport();
const pet = makePet();
const readings = [
  makeReading({ id: 'feb', date: '2024-02-15T12:00:00.000Z' }),
  makeReading({ id: 'march', date: '2024-03-15T12:00:00.000Z' }),
];

const q = <T extends Element>(selector: string) => document.body.querySelector<T>(selector);
const exportButton = () => q<HTMLButtonElement>('.btn-export')!;
const notesSwitch = () => q<HTMLButtonElement>('[role="switch"]')!;
const monthBoxes = () => [...document.body.querySelectorAll<HTMLInputElement>('.month-row input')];

function mountModal() {
  return mount(PdfExportModal, {
    props: { pet, readings },
    attachTo: document.body,
    global: { plugins: [createTestI18n()] },
  });
}

describe('PdfExportModal', () => {
  beforeEach(() => {
    isGenerating.value = false;
    vi.mocked(generatePdf).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('exports every month, newest first, without notes by default', async () => {
    mountModal();
    expect(monthBoxes().map((b) => b.checked)).toEqual([true, true]);
    exportButton().click();
    await flushPromises();
    expect(generatePdf).toHaveBeenCalledWith(pet, readings, ['2024-03', '2024-02'], true, false);
  });

  it('passes the chosen order, notes and months', async () => {
    mountModal();
    document.body.querySelectorAll<HTMLButtonElement>('.sort-btn')[1].click();
    notesSwitch().click();
    monthBoxes()[0].click();
    await flushPromises();
    exportButton().click();
    await flushPromises();
    expect(generatePdf).toHaveBeenCalledWith(pet, readings, ['2024-02'], false, true);
  });

  it('names the notes switch and reports its state', async () => {
    mountModal();
    const labelId = notesSwitch().getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe('Include reading notes');
    expect(notesSwitch().getAttribute('aria-checked')).toBe('false');
    notesSwitch().click();
    await flushPromises();
    expect(notesSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('exposes the order as pressed buttons in a labelled group', async () => {
    mountModal();
    const group = q('.sort-options')!;
    expect(group.getAttribute('role')).toBe('group');
    const labelId = group.getAttribute('aria-labelledby');
    expect(labelId && document.getElementById(labelId)?.textContent).toBe('Order');
    const sortButtons = () => [...group.querySelectorAll('.sort-btn')];
    expect(sortButtons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    sortButtons()[1].dispatchEvent(new MouseEvent('click'));
    await flushPromises();
    expect(sortButtons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('needs at least one month', async () => {
    mountModal();
    q<HTMLButtonElement>('.toggle-all-btn')!.click();
    await flushPromises();
    expect(q('.empty-hint')).not.toBeNull();
    expect(exportButton().disabled).toBe(true);
  });

  it('shows an alert on failure and clears it when the selection changes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(generatePdf).mockRejectedValueOnce(new Error('chunk failed'));
    const wrapper = mountModal();
    exportButton().click();
    await flushPromises();
    expect(q('[role="alert"]')?.textContent?.trim()).toBe(
      'The PDF could not be created. Please try again. If it keeps failing, close and reopen the app.',
    );
    expect(error).toHaveBeenCalled();
    // Export stays available as the retry the message asks for.
    expect(exportButton().disabled).toBe(false);
    expect(wrapper.emitted('close')).toBeUndefined();

    monthBoxes()[1].click();
    await flushPromises();
    expect(q('[role="alert"]')).toBeNull();
  });

  it('closes 200 ms after a successful export', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const wrapper = mountModal();
    exportButton().click();
    await flushPromises();
    vi.advanceTimersByTime(199);
    expect(wrapper.emitted('close')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('cannot be closed while generating', async () => {
    const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    isGenerating.value = true;
    const wrapper = mountModal();
    await flushPromises();
    escape();
    q<HTMLElement>('.overlay')!.click();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(exportButton().textContent).toContain('Generating…');

    isGenerating.value = false;
    await flushPromises();
    escape();
    q<HTMLElement>('.overlay')!.click();
    expect(wrapper.emitted('close')).toHaveLength(2);
  });
});
