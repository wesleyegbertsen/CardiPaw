// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import PetDetailView from './PetDetailView.vue';
import { usePetsStore } from '../stores/pets';
import { mountView, settle, type MountViewOptions } from '../test/mountView';
import { makeNote, makePet, makeReading } from '../test/fixtures';
import { deferred } from '../test/deferred';
import { createTestI18n } from '../test/i18n';
import * as db from '../services/db';
import type { Reading } from '../types';

// Chart.js needs a canvas; the view's job is to hand the chart the right readings.
vi.mock('../components/RRRChart.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'RRRChartStub',
      props: { readings: { type: Array, required: true }, maxTicks: Number, normalCeiling: Number },
      setup: () => () => h('div', { class: 'chart-stub' }),
    }),
  };
});

enableAutoUnmount(afterEach);

const pet = makePet();

function mountDetail(location: string, data: MountViewOptions = {}) {
  return mountView(PetDetailView, location, { pets: [pet], ...data });
}

const tabs = (wrapper: VueWrapper) => wrapper.findAll('.tab');
const activeTabIndex = (wrapper: VueWrapper) =>
  tabs(wrapper).findIndex((t) => t.classes().includes('active'));

describe('PetDetailView', () => {
  afterEach(() => vi.useRealTimers());

  it('goes home for an unknown pet', async () => {
    const { push, wrapper } = await mountView(PetDetailView, '/pets/missing');
    expect(push).toHaveBeenCalledWith({ name: 'home' });
    expect(wrapper.find('.page').exists()).toBe(false);
  });

  it('shows ? as the avatar for a pet without a name', async () => {
    const { wrapper } = await mountView(PetDetailView, '/pets/pet-1', {
      pets: [makePet({ name: '' })],
    });
    expect(wrapper.get('.avatar-placeholder').text()).toBe('?');
  });

  it('opens the tab from the URL and falls back to the chart', async () => {
    expect(activeTabIndex((await mountDetail('/pets/pet-1?tab=notes')).wrapper)).toBe(2);
    expect(activeTabIndex((await mountDetail('/pets/pet-1?tab=bogus')).wrapper)).toBe(0);
  });

  it('counts readings and notes, and keeps the query when switching tabs', async () => {
    const { wrapper, replace, router } = await mountDetail('/pets/pet-1?x=1', {
      readings: [makeReading(), makeReading({ id: 'r2' })],
      notes: [makeNote()],
    });
    expect(tabs(wrapper)[1].get('.tab-count').text()).toBe('2');
    expect(tabs(wrapper)[2].get('.tab-count').text()).toBe('1');

    await tabs(wrapper)[2].trigger('click');
    expect(replace).toHaveBeenCalledWith({ query: { x: '1', tab: 'notes' } });
    await settle();
    expect(router.currentRoute.value.query.tab).toBe('notes');
    expect(activeTabIndex(wrapper)).toBe(2);
  });

  it('opens the edit form and the tracker', async () => {
    const { wrapper, push } = await mountDetail('/pets/pet-1');
    const edit = wrapper.findAll('.header-actions .icon-btn')[2];
    await edit.trigger('click');
    await wrapper.get('.track-cta .track-btn').trigger('click');
    expect(push.mock.calls).toEqual([
      [{ name: 'pet-edit', params: { id: 'pet-1' } }],
      [{ name: 'tracker', params: { id: 'pet-1' } }],
    ]);
  });

  describe('delete', () => {
    it('removes the pet and goes home after confirming', async () => {
      const { wrapper, push } = await mountDetail('/pets/pet-1');
      await wrapper.get('.icon-btn.danger').trigger('click');
      document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
      await settle();
      expect(usePetsStore().pets).toEqual([]);
      expect(push).toHaveBeenCalledWith({ name: 'home' });
    });

    it('keeps the pet and returns focus to the delete button on cancel', async () => {
      const { wrapper, push } = await mountDetail('/pets/pet-1');
      const remove = wrapper.get('.icon-btn.danger');
      (remove.element as HTMLElement).focus();
      await remove.trigger('click');
      await flushPromises();
      expect(document.activeElement?.classList.contains('btn-cancel')).toBe(true);

      document.body.querySelector<HTMLButtonElement>('.btn-cancel')!.click();
      await flushPromises();
      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.activeElement).toBe(remove.element);
      expect(usePetsStore().pets).toHaveLength(1);
      expect(push).not.toHaveBeenCalled();
    });
    it('reports a failed delete, keeps the pet and returns focus', async () => {
      vi.spyOn(db, 'deletePet').mockRejectedValueOnce(new Error('quota'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper, push } = await mountDetail('/pets/pet-1');
      const remove = wrapper.get('.icon-btn.danger');
      (remove.element as HTMLElement).focus();
      await remove.trigger('click');
      document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
      await settle();

      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.activeElement).toBe(remove.element);
      expect(wrapper.get('[role="alert"]').text()).toContain('could not be fully deleted');
      expect(usePetsStore().pets).toHaveLength(1);
      expect(error).toHaveBeenCalledWith('Deleting pet failed', expect.any(Error));
      expect(push).not.toHaveBeenCalled();
    });

    it('deletes on a retry after a failed delete', async () => {
      vi.spyOn(db, 'deletePet').mockRejectedValueOnce(new Error('quota'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper, push } = await mountDetail('/pets/pet-1');
      for (let attempt = 0; attempt < 2; attempt++) {
        await wrapper.get('.icon-btn.danger').trigger('click');
        document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
        await settle();
      }
      expect(usePetsStore().pets).toEqual([]);
      expect(push).toHaveBeenCalledWith({ name: 'home' });
    });

    it('deletes once when confirm is clicked twice', async () => {
      const pending = deferred<void>();
      const deletePet = vi.spyOn(db, 'deletePet').mockReturnValue(pending.promise);
      const { wrapper } = await mountDetail('/pets/pet-1');
      await wrapper.get('.icon-btn.danger').trigger('click');
      const confirm = document.body.querySelector<HTMLButtonElement>('.btn-confirm')!;
      confirm.click();
      confirm.click();
      pending.resolve();
      await settle();
      expect(deletePet).toHaveBeenCalledTimes(1);
    });

    it('warns that notes are deleted too', async () => {
      const { wrapper } = await mountDetail('/pets/pet-1');
      await wrapper.get('.icon-btn.danger').trigger('click');
      expect(document.body.querySelector('[role="alertdialog"] .message')!.textContent).toContain(
        'readings and notes',
      );
    });
  });

  it('shows an error with a way back when the pet cannot load', async () => {
    vi.spyOn(db, 'getAllPets').mockRejectedValueOnce(new Error('idb broken'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper, push } = await mountDetail('/pets/pet-1');
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(push).not.toHaveBeenCalled();
    await wrapper.get('.back-btn').trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'home' });
    expect(error).toHaveBeenCalledWith('Loading pet failed', expect.any(Error));
  });

  it.each([
    ['readings', 'getReadingsForPet'],
    ['notes', 'getNotesForPet'],
  ] as const)('shows the pet with an alert when its %s fail to load', async (what, method) => {
    vi.spyOn(db, method).mockRejectedValueOnce(new Error('idb broken'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper, push } = await mountDetail('/pets/pet-1', {
      readings: [makeReading()],
      notes: [makeNote()],
    });
    expect(wrapper.find('.icon-btn.danger').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(error).toHaveBeenCalledWith(`Loading ${what} failed`, expect.any(Error));
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps showing a cached pet with an alert when the pets fail to load', async () => {
    // The first visit caches the pet. It stays mounted: unmounting the router's last
    // app resets the current route, which the second mount would then read as empty.
    const first = await mountDetail('/pets/pet-1', { readings: [makeReading()] });

    vi.spyOn(db, 'getAllPets').mockRejectedValueOnce(new Error('idb broken'));
    const getReadings = vi.spyOn(db, 'getReadingsForPet');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mount(PetDetailView, {
      attachTo: document.body,
      global: { plugins: [first.pinia, first.router, createTestI18n()] },
    });
    await settle();

    expect(error).toHaveBeenCalledWith('Loading pet failed', expect.any(Error));
    expect(wrapper.find('.icon-btn.danger').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(getReadings).toHaveBeenCalledWith('pet-1');
    expect(tabs(wrapper)[1].get('.tab-count').text()).toBe('1');
    expect(first.push).not.toHaveBeenCalled();
  });

  describe('chart', () => {
    // Wednesday 20 March 2024. Only the clock is faked: fake timers stall fake-indexeddb.
    const readings: Reading[] = [
      makeReading({ id: 'a', date: '2024-03-18T08:00:00.000Z', rate: 20 }),
      makeReading({ id: 'b', date: '2024-03-18T20:00:00.000Z', rate: 25 }),
      makeReading({ id: 'c', date: '2024-02-10T08:00:00.000Z', rate: 30 }),
    ];

    async function mountChart() {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2024-03-20T12:00:00.000Z'));
      const result = await mountDetail('/pets/pet-1', {
        pets: [makePet({ normalCeiling: 28 })],
        readings,
      });
      const { wrapper } = result;
      const chart = () => wrapper.getComponent({ name: 'RRRChartStub' });
      const range = (i: number) => wrapper.findAll('.range-toggle button')[i].trigger('click');
      const [prev, next] = wrapper.findAll('.range-nav .nav-btn');
      const label = () => wrapper.get('.range-label-btn').text();
      return { ...result, chart, range, prev, next, label };
    }

    it('shows this week’s readings, newest first, with the pet’s ceiling', async () => {
      const { chart, prev, next } = await mountChart();
      expect((chart().props('readings') as Reading[]).map((r) => r.id)).toEqual(['b', 'a']);
      expect(chart().props('normalCeiling')).toBe(28);
      expect(chart().props('maxTicks')).toBe(8);
      expect(prev.attributes('disabled')).toBeUndefined();
      expect(next.attributes('disabled')).toBeDefined();
    });

    it('sends rounded daily averages in the month view', async () => {
      const { chart, range } = await mountChart();
      await range(1);
      expect(chart().props('readings')).toEqual([
        { id: '2024-03-18', petId: 'pet-1', date: '2024-03-18T12:00:00', rate: 23, clickCount: 0 },
      ]);
      expect(chart().props('maxTicks')).toBe(6);
    });

    it('goes back to the current period when the range changes', async () => {
      const { range, prev, next, label } = await mountChart();
      await range(1);
      expect(label()).toBe('March 2024');
      await prev.trigger('click');
      expect(label()).toBe('February 2024');
      expect(next.attributes('disabled')).toBeUndefined();
      // No readings before February.
      expect(prev.attributes('disabled')).toBeDefined();

      await range(2);
      expect(label()).toBe('2024');
      expect(prev.attributes('disabled')).toBeDefined();
      expect(next.attributes('disabled')).toBeDefined();
    });

    it('disables future months and months without readings in the jump picker', async () => {
      const { wrapper, range, label } = await mountChart();
      await range(1);
      await wrapper.get('.range-label-btn').trigger('click');
      const months = wrapper.findAll('.jump-month-btn');
      expect(months).toHaveLength(12);
      const enabled = months.filter((m) => m.attributes('disabled') === undefined);
      expect(enabled.map((m) => m.text())).toEqual(['Feb', 'Mar']);

      await enabled[0].trigger('click');
      expect(wrapper.find('.jump-picker').exists()).toBe(false);
      expect(label()).toBe('February 2024');
    });
  });
});
