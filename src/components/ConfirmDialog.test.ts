// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import ConfirmDialog from './ConfirmDialog.vue';

// useModal tracks open dialogs in module state; don't let one test's dialog outlive it.
enableAutoUnmount(afterEach);

function mountDialog() {
  return mount(ConfirmDialog, {
    attachTo: document.body,
    props: { message: 'Delete this reading?' },
    global: {
      stubs: { teleport: true },
      mocks: { $t: (key: string) => key },
    },
  });
}

describe('ConfirmDialog', () => {
  it('shows the message as text', () => {
    expect(mountDialog().get('.message').text()).toBe('Delete this reading?');
  });

  it('emits confirm from the confirm button', async () => {
    const wrapper = mountDialog();
    await wrapper.get('.btn-confirm').trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('cancel')).toBeUndefined();
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
