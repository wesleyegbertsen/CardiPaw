import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SlideToggle from './SlideToggle.vue';

const mountToggle = (props: { modelValue: boolean; disabled?: boolean; describedby?: string }) =>
  mount(SlideToggle, { props: { labelledby: 'label-id', ...props } });

describe('SlideToggle', () => {
  it('is a switch named by its label that reports its state', () => {
    const toggle = mountToggle({ modelValue: true });
    expect(toggle.attributes('role')).toBe('switch');
    expect(toggle.attributes('aria-labelledby')).toBe('label-id');
    expect(toggle.attributes('aria-checked')).toBe('true');
    expect(toggle.attributes('aria-describedby')).toBeUndefined();
  });

  it('points at its description when given one', () => {
    const toggle = mountToggle({ modelValue: false, describedby: 'desc-id' });
    expect(toggle.attributes('aria-describedby')).toBe('desc-id');
  });

  it('flips the model on click', async () => {
    const toggle = mountToggle({ modelValue: false });
    await toggle.trigger('click');
    expect(toggle.emitted('update:modelValue')).toEqual([[true]]);
  });

  it('does nothing while disabled', async () => {
    const toggle = mountToggle({ modelValue: false, disabled: true });
    expect(toggle.attributes('disabled')).toBeDefined();
    await toggle.trigger('click');
    expect(toggle.emitted('update:modelValue')).toBeUndefined();
  });
});
