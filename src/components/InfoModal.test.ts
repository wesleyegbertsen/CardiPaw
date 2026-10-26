import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import InfoModal from './InfoModal.vue';
import { createTestI18n } from '../test/i18n';

enableAutoUnmount(afterEach);

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)!;

function mountModal() {
  return mount(InfoModal, {
    props: { title: 'About thresholds' },
    slots: { default: '<p class="slotted">Ask your vet.</p>' },
    attachTo: document.body,
    global: { plugins: [createTestI18n()] },
  });
}

describe('InfoModal', () => {
  it('is labelled by its title and shows the slot', () => {
    mountModal();
    const dialog = q('[role="dialog"]');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    expect(title?.textContent).toBe('About thresholds');
    expect(q('.slotted').textContent).toBe('Ask your vet.');
  });

  it('closes from ✕, the footer button, Escape and the backdrop', () => {
    const wrapper = mountModal();
    q('.btn-close').click();
    q('.btn-ok').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    q('.overlay').click();
    expect(wrapper.emitted('close')).toHaveLength(4);
  });

  it('stays open when the dialog body is clicked', () => {
    const wrapper = mountModal();
    q('.dialog-body').click();
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
