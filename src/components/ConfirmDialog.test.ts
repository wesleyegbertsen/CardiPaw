// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfirmDialog from './ConfirmDialog.vue';

function mountDialog() {
  return mount(ConfirmDialog, {
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
});
