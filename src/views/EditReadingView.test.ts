import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import EditReadingView from './EditReadingView.vue';
import { useReadingsStore } from '../stores/readings';
import * as db from '../services/db';
import { mountView, settle } from '../test/mountView';
import { deferred } from '../test/deferred';
import { createTestI18n } from '../test/i18n';
import { makePet, makeReading } from '../test/fixtures';
import type { Reading } from '../types';

vi.mock('../components/LazyRichTextEditor', async () =>
  (await import('../test/stubs')).lazyEditorStubModule(),
);

const location = '/pets/pet-1/readings/reading-1/edit';

async function mountEdit(reading: Reading = makeReading()) {
  const result = await mountView(EditReadingView, location, {
    pets: [makePet()],
    readings: [reading],
  });
  const { wrapper } = result;
  return {
    ...result,
    rate: wrapper.get<HTMLInputElement>('.rate-input'),
    submit: wrapper.get<HTMLButtonElement>('.submit-btn'),
    badge: () => wrapper.find('.rate-badge'),
  };
}

describe('EditReadingView', () => {
  it('goes to the pet’s readings for an unknown reading', async () => {
    const { push } = await mountView(EditReadingView, location, { pets: [makePet()] });
    expect(push).toHaveBeenCalledWith({
      name: 'pet',
      params: { id: 'pet-1' },
      query: { tab: 'readings' },
    });
  });

  it('does not go to the pet’s readings after the user already left', async () => {
    const load = deferred<Reading[]>();
    vi.spyOn(db, 'getReadingsForPet').mockReturnValueOnce(load.promise);
    const { push, wrapper } = await mountView(EditReadingView, location, { pets: [makePet()] });
    wrapper.unmount();
    load.resolve([]);
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it('prefills the rate, rest state and notes', async () => {
    const { wrapper, rate, badge } = await mountEdit(
      makeReading({ rate: 33, restState: 'sleeping', notes: '<p>Calm</p>' }),
    );
    expect(rate.element.value).toBe('33');
    expect(badge().text()).toBe('Elevated');
    expect(wrapper.get('.rest-btn.active').text()).toBe('Sleeping');
    expect((wrapper.get('.notes-stub').element as HTMLTextAreaElement).value).toBe('<p>Calm</p>');
  });

  it.each([
    [makeReading({ durationSeconds: 60 }), 'Guided (60\u00a0s)'],
    [makeReading(), 'Guided (30\u00a0s)'],
  ])('labels a guided reading with its length (%#)', async (reading, label) => {
    const { wrapper } = await mountEdit(reading);
    expect(wrapper.get('.source-chip').text()).toBe(label);
  });

  it('labels the rate, rest state and notes fields', async () => {
    const { wrapper, rate } = await mountEdit(makeReading({ restState: 'sleeping' }));
    expect(rate.attributes('id')).toBeTruthy();
    expect(wrapper.get('label.label').attributes('for')).toBe(rate.attributes('id'));
    const labelText = (el: { attributes: (n: string) => string | undefined }) =>
      document.getElementById(el.attributes('aria-labelledby')!)?.textContent;
    const group = wrapper.get('.rest-state-row');
    expect(group.attributes('role')).toBe('group');
    expect(labelText(group)).toBe('Pet was');
    expect(wrapper.findAll('.rest-btn').map((b) => b.attributes('aria-pressed'))).toEqual([
      'false',
      'true',
    ]);
    expect(labelText(wrapper.get('.notes-stub'))).toBe('Notes');
  });

  it('hides the badge and disables save when the rate is cleared', async () => {
    const { rate, submit, badge } = await mountEdit();
    // The status pill describes the rate input while it is shown
    const describedBy = rate.attributes('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).toBe(badge().attributes('id'));
    await rate.setValue('');
    expect(badge().exists()).toBe(false);
    expect(rate.attributes('aria-describedby')).toBeUndefined();
    expect(submit.element.disabled).toBe(true);
  });

  it.each(['0', '12.5', '250'])('blocks saving a new rate of %s', async (value) => {
    const { wrapper, rate, submit, badge } = await mountEdit();
    const update = vi.spyOn(useReadingsStore(), 'updateReading');
    await rate.setValue(value);
    expect(submit.element.disabled).toBe(true);
    expect(badge().exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps a stored guided rate above 200 saveable while it is unchanged', async () => {
    const { wrapper, rate, submit, badge, replace } = await mountEdit(
      makeReading({ rate: 230, clickCount: 115 }),
    );
    expect(submit.element.disabled).toBe(false);
    expect(badge().text()).toBe('High');

    await rate.setValue('250');
    expect(submit.element.disabled).toBe(true);

    await rate.setValue('230');
    await wrapper.get('.notes-stub').setValue('<p>Purring</p>');
    await wrapper.get('form').trigger('submit');
    await settle();
    expect(useReadingsStore().getReadingsForPet('pet-1')[0]).toMatchObject({
      rate: 230,
      notes: '<p>Purring</p>',
    });
    expect(replace).toHaveBeenCalledWith({
      name: 'reading',
      params: { id: 'pet-1', readingId: 'reading-1' },
    });
  });

  // The input's min/max would make the browser refuse these submits; the form opts out
  // of native validation so the view's own rule (unchanged stored rates save) applies.
  it.each([230, 0])(
    'saves notes on a stored rate of %s when the button is clicked',
    async (stored) => {
      const { wrapper, submit, replace } = await mountEdit(
        makeReading({ rate: stored, clickCount: stored / 2 }),
      );
      expect(wrapper.get('form').attributes()).toHaveProperty('novalidate');

      await wrapper.get('.notes-stub').setValue('<p>Purring</p>');
      await submit.trigger('click');
      await settle();
      expect(useReadingsStore().getReadingsForPet('pet-1')[0]).toMatchObject({
        rate: stored,
        notes: '<p>Purring</p>',
      });
      expect(replace).toHaveBeenCalledWith({
        name: 'reading',
        params: { id: 'pet-1', readingId: 'reading-1' },
      });
    },
  );

  it('keeps a guided reading’s measurement length when saving an edit', async () => {
    const { wrapper, rate } = await mountEdit(makeReading({ durationSeconds: 60 }));
    const update = vi.spyOn(useReadingsStore(), 'updateReading');

    await rate.setValue('28');
    await wrapper.get('form').trigger('submit');
    await settle();

    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0]).toMatchObject({ rate: 28, durationSeconds: 60 });
  });

  it('toggles the rest state and saves empty notes as undefined', async () => {
    const { wrapper, rate, replace } = await mountEdit(
      makeReading({ restState: 'resting', notes: '<p>Old</p>' }),
    );
    const update = vi.spyOn(useReadingsStore(), 'updateReading');
    const [resting, sleeping] = wrapper.findAll('.rest-btn');

    await resting.trigger('click');
    expect(wrapper.find('.rest-btn.active').exists()).toBe(false);
    await sleeping.trigger('click');
    expect(sleeping.classes()).toContain('active');

    await rate.setValue('28');
    await wrapper.get('.notes-stub').setValue('');
    await wrapper.get('form').trigger('submit');
    await settle();

    expect(update).toHaveBeenCalledWith({
      ...makeReading(),
      rate: 28,
      restState: 'sleeping',
      notes: undefined,
    });
    expect(replace).toHaveBeenCalledWith({
      name: 'reading',
      params: { id: 'pet-1', readingId: 'reading-1' },
    });
  });

  it('goes back to the reading', async () => {
    const { wrapper, replace } = await mountEdit();
    await wrapper.get('.back-btn').trigger('click');
    expect(replace).toHaveBeenCalledWith({
      name: 'reading',
      params: { id: 'pet-1', readingId: 'reading-1' },
    });
  });

  it('reports a failed save and keeps the edits', async () => {
    vi.spyOn(db, 'saveReading').mockRejectedValueOnce(new Error('quota'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper, rate, submit, replace } = await mountEdit();
    await rate.setValue('28');
    await wrapper.get('form').trigger('submit');
    await settle();
    expect(wrapper.get('.save-error').text()).toBe('This could not be saved. Please try again.');
    expect(error).toHaveBeenCalledWith('Saving reading failed', expect.any(Error));
    expect(replace).not.toHaveBeenCalled();
    expect(rate.element.value).toBe('28');
    expect(submit.element.disabled).toBe(false);
  });

  it('reports a failed load', async () => {
    vi.spyOn(db, 'getReadingsForPet').mockRejectedValueOnce(new Error('idb broken'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper, push } = await mountView(EditReadingView, location, { pets: [makePet()] });
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(error).toHaveBeenCalledWith('Loading reading failed', expect.any(Error));
    expect(push).not.toHaveBeenCalled();
  });

  it('hides the form when loading fails for a reading cached from an earlier visit', async () => {
    const cached = makeReading({ restState: 'resting', notes: '<p>Calm</p>' });
    // The first visit caches the reading. It stays mounted: unmounting the router's last
    // app resets the current route, which the second mount would then read as empty.
    const first = await mountEdit(cached);

    vi.spyOn(db, 'getReadingsForPet').mockRejectedValueOnce(new Error('idb broken'));
    const save = vi.spyOn(db, 'saveReading');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mount(EditReadingView, {
      attachTo: document.body,
      global: { plugins: [first.pinia, first.router, createTestI18n()] },
    });
    await settle();

    expect(useReadingsStore().getReadingsForPet('pet-1')).toEqual([cached]);
    expect(error).toHaveBeenCalledWith('Loading reading failed', expect.any(Error));
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});
