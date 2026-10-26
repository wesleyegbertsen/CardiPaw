import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import OnboardingModal from './OnboardingModal.vue';
import { createTestI18n } from '../test/i18n';
import { touchEvent } from '../test/touch';

const q = <T extends Element = HTMLElement>(selector: string) =>
  document.body.querySelector<T>(selector);
const stepCount = () => q('.step-count')!.textContent;
const nextButton = () => q<HTMLButtonElement>('.btn-next')!;

function mountModal() {
  return mount(OnboardingModal, {
    attachTo: document.body,
    global: { plugins: [createTestI18n()] },
  });
}

async function click(el: HTMLElement) {
  el.click();
  await flushPromises();
}

async function swipe(dx: number, dy = 0) {
  const body = q('.dialog-body')!;
  const touch = (type: string, x: number, y: number) =>
    body.dispatchEvent(touchEvent(type, [{ clientX: x, clientY: y }]));
  touch('touchstart', 100, 100);
  touch('touchend', 100 + dx, 100 + dy);
  await flushPromises();
}

describe('OnboardingModal', () => {
  it('walks through the four steps and closes on the last one', async () => {
    const wrapper = mountModal();
    expect(stepCount()).toBe('Step 1 of 4');
    expect(q('.step-title')!.textContent).toBe('Get your pet resting or sleeping');
    expect(q('.btn-back')).toBeNull();

    for (const n of [2, 3, 4]) {
      await click(nextButton());
      expect(stepCount()).toBe(`Step ${n} of 4`);
    }
    expect(q('.step-title')!.textContent).toBe('When not to measure');
    expect(nextButton().textContent).toBe('Got it, start tracking');
    expect(document.body.querySelectorAll('.dot.active')).toHaveLength(1);

    await click(nextButton());
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('moves focus to Next when Back disappears on the first step', async () => {
    mountModal();
    await click(nextButton());
    const back = q<HTMLButtonElement>('.btn-back')!;
    back.focus();
    await click(back);
    expect(stepCount()).toBe('Step 1 of 4');
    expect(q('.btn-back')).toBeNull();
    expect(document.activeElement).toBe(nextButton());
  });

  it('follows horizontal swipes of at least 40 px', async () => {
    mountModal();
    await swipe(-40);
    expect(stepCount()).toBe('Step 2 of 4');
    await swipe(-39);
    expect(stepCount()).toBe('Step 2 of 4');
    await swipe(60);
    expect(stepCount()).toBe('Step 1 of 4');
  });

  it('ignores mostly vertical swipes', async () => {
    mountModal();
    await swipe(-50, 80);
    expect(stepCount()).toBe('Step 1 of 4');
  });

  it('closes on Skip, Escape and the backdrop', async () => {
    const wrapper = mountModal();
    await click(q('.btn-skip')!);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await click(q('.overlay')!);
    expect(wrapper.emitted('close')).toHaveLength(3);
  });

  it('does not close when the dialog itself is clicked', async () => {
    const wrapper = mountModal();
    await click(q('.dialog')!);
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
