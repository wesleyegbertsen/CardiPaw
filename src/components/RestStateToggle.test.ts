// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { h } from 'vue';
import RestStateToggle from './RestStateToggle.vue';
import { createTestI18n } from '../test/i18n';

enableAutoUnmount(afterEach);

type RestState = 'resting' | 'sleeping' | undefined;

function mountToggle(modelValue: RestState, layout?: 'inline' | 'stacked') {
  const wrapper = mount(RestStateToggle, {
    props: {
      modelValue,
      layout,
      'onUpdate:modelValue': (value: RestState) => wrapper.setProps({ modelValue: value }),
    },
    attachTo: document.body,
    global: { plugins: [createTestI18n()] },
  });
  return wrapper;
}

describe('RestStateToggle', () => {
  it('is a group named "Pet was" with a unique label id per instance', () => {
    // useId is unique within one app, so both instances share a parent
    const wrapper = mount(() => [h(RestStateToggle), h(RestStateToggle)], {
      attachTo: document.body,
      global: { plugins: [createTestI18n()] },
    });
    const groups = wrapper.findAll('[role="group"]');
    const labelIds = groups.map((g) => g.attributes('aria-labelledby'));
    expect(labelIds[0]).toBeTruthy();
    expect(labelIds[0]).not.toBe(labelIds[1]);
    expect(document.getElementById(labelIds[0]!)?.textContent).toBe('Pet was');
  });

  it('presses one state at a time and releases it on a second click', async () => {
    const wrapper = mountToggle('sleeping');
    const buttons = wrapper.findAll('.rest-btn');
    const pressed = () => buttons.map((b) => b.attributes('aria-pressed'));
    expect(buttons.map((b) => b.text())).toEqual(['Resting', 'Sleeping']);
    expect(buttons.map((b) => b.attributes('type'))).toEqual(['button', 'button']);
    expect(pressed()).toEqual(['false', 'true']);
    expect(wrapper.get('.rest-btn.active').text()).toBe('Sleeping');

    await buttons[0].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['resting']]);
    expect(pressed()).toEqual(['true', 'false']);
    await buttons[0].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['resting'], [undefined]]);
    expect(pressed()).toEqual(['false', 'false']);
  });

  it('lays out inline by default, or stacked', () => {
    expect(mountToggle(undefined).classes()).toContain('inline');
    expect(mountToggle(undefined, 'stacked').classes()).toContain('stacked');
  });
});
