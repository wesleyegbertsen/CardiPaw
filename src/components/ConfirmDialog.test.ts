import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfirmDialog from './ConfirmDialog.vue';
import { createTestI18n } from '../test/i18n';

function mountDialog(props: { confirmLabel?: string; confirmDelayMs?: number } = {}) {
  return mount(ConfirmDialog, {
    attachTo: document.body,
    props: { message: 'Delete this reading?', ...props },
    global: {
      plugins: [createTestI18n()],
      stubs: { teleport: true },
    },
  });
}

describe('ConfirmDialog', () => {
  it('shows the message as text', () => {
    expect(mountDialog().get('.message').text()).toBe('Delete this reading?');
  });

  it('labels both buttons', () => {
    const wrapper = mountDialog();
    expect(wrapper.get('.btn-cancel').text()).toBe('Cancel');
    expect(wrapper.get('.btn-confirm').text()).toBe('Confirm');
  });

  it('names the confirm button with confirmLabel when given', () => {
    const wrapper = mountDialog({ confirmLabel: 'Discard' });
    expect(wrapper.get('.btn-confirm').text()).toBe('Discard');
    expect(wrapper.get('.btn-cancel').text()).toBe('Cancel');
  });

  it('emits confirm from the confirm button', async () => {
    const wrapper = mountDialog();
    await wrapper.get('.btn-confirm').trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('cancel')).toBeUndefined();
  });

  describe('with confirmDelayMs', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('ignores the confirm button until the delay has passed', async () => {
      vi.useFakeTimers();
      const wrapper = mountDialog({ confirmDelayMs: 500 });
      await wrapper.get('.btn-confirm').trigger('click');
      vi.advanceTimersByTime(499);
      await wrapper.get('.btn-confirm').trigger('click');
      expect(wrapper.emitted('confirm')).toBeUndefined();

      vi.advanceTimersByTime(1);
      await wrapper.get('.btn-confirm').trigger('click');
      expect(wrapper.emitted('confirm')).toHaveLength(1);
    });

    it('still cancels at once', async () => {
      vi.useFakeTimers();
      const wrapper = mountDialog({ confirmDelayMs: 500 });
      await wrapper.get('.btn-cancel').trigger('click');
      expect(wrapper.emitted('cancel')).toHaveLength(1);
    });
  });

  it('emits cancel from the cancel button and from the backdrop', async () => {
    const wrapper = mountDialog();
    await wrapper.get('.btn-cancel').trigger('click');
    await wrapper.get('.overlay').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(2);
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });

  it('does not cancel when the dialog itself is clicked', async () => {
    const wrapper = mountDialog();
    await wrapper.get('.dialog').trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
  });

  it('starts with focus on Cancel so Enter cannot confirm by accident', () => {
    const wrapper = mountDialog();
    expect(document.activeElement).toBe(wrapper.get('.btn-cancel').element);
  });

  it('emits cancel on Escape', () => {
    const wrapper = mountDialog();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});
