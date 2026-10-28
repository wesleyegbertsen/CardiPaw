import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useModal } from './useModal';

// opener() adds buttons outside any wrapper; remove them even when a test fails early.
afterEach(() => document.body.replaceChildren());

/** A dialog with three buttons, mounted only while open (v-if style). */
function makeDialog(onClose: () => void, extra: { open?: Ref<boolean> } = {}) {
  return defineComponent({
    setup() {
      const dialogRef = ref<HTMLElement | null>(null);
      useModal(dialogRef, { onClose, ...extra });
      return () =>
        h('div', { ref: dialogRef, tabindex: -1, class: 'dialog' }, [
          h('button', { class: 'first' }, 'first'),
          h('button', { class: 'middle' }, 'middle'),
          h('button', { class: 'last' }, 'last'),
        ]);
    },
  });
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

const active = () => document.activeElement as HTMLElement | null;

function opener() {
  const button = document.createElement('button');
  button.textContent = 'open';
  document.body.appendChild(button);
  button.focus();
  return button;
}

describe('useModal', () => {
  it('moves focus to the first control on open', () => {
    const wrapper = mount(makeDialog(vi.fn()), { attachTo: document.body });
    expect(active()).toBe(wrapper.get('.first').element);
  });

  it('closes only the top dialog on Escape', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    mount(makeDialog(outerClose), { attachTo: document.body });
    mount(makeDialog(innerClose), { attachTo: document.body });

    const event = press('Escape');

    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('hands Escape to the dialog below once the top one closes', () => {
    const outerClose = vi.fn();
    mount(makeDialog(outerClose), { attachTo: document.body });
    const inner = mount(makeDialog(vi.fn()), { attachTo: document.body });

    inner.unmount();
    press('Escape');

    expect(outerClose).toHaveBeenCalledOnce();
  });

  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    const wrapper = mount(makeDialog(vi.fn()), { attachTo: document.body });
    const first = wrapper.get('.first').element as HTMLElement;
    const last = wrapper.get('.last').element as HTMLElement;

    last.focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(active()).toBe(first);

    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(active()).toBe(last);
  });

  it('leaves Tab between inner controls to the browser', () => {
    const wrapper = mount(makeDialog(vi.fn()), { attachTo: document.body });
    (wrapper.get('.middle').element as HTMLElement).focus();
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it('pulls focus back in when Tab is pressed from outside the dialog', () => {
    const wrapper = mount(makeDialog(vi.fn()), { attachTo: document.body });
    (document.activeElement as HTMLElement).blur();
    press('Tab');
    expect(active()).toBe(wrapper.get('.first').element);
  });

  it('returns focus to the opener on close', () => {
    const button = opener();
    const wrapper = mount(makeDialog(vi.fn()), { attachTo: document.body });
    expect(active()).not.toBe(button);

    wrapper.unmount();

    expect(active()).toBe(button);
    button.remove();
  });

  it('activates and deactivates with the open ref for a dialog that stays mounted', async () => {
    const button = opener();
    const open = ref(false);
    const onClose = vi.fn();
    const wrapper = mount(makeDialog(onClose, { open }), { attachTo: document.body });

    press('Escape');
    expect(onClose).not.toHaveBeenCalled();

    open.value = true;
    // One tick for the watcher, one for its own nextTick before activating.
    await nextTick();
    await nextTick();
    expect(active()).toBe(wrapper.get('.first').element);
    press('Escape');
    expect(onClose).toHaveBeenCalledOnce();

    open.value = false;
    await nextTick();
    expect(active()).toBe(button);
    press('Escape');
    expect(onClose).toHaveBeenCalledOnce();
    button.remove();
  });

  it('ignores Escape while canClose returns false', () => {
    const onClose = vi.fn();
    let busy = true;
    const Busy = defineComponent({
      setup() {
        const dialogRef = ref<HTMLElement | null>(null);
        useModal(dialogRef, { onClose, canClose: () => !busy });
        return () => h('div', { ref: dialogRef, tabindex: -1 }, [h('button', 'ok')]);
      },
    });
    mount(Busy, { attachTo: document.body });

    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    busy = false;
    press('Escape');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
