import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import PetDetailView from './PetDetailView.vue';
import { usePetsStore } from '../stores/pets';
import { mountView, settle, type MountViewOptions } from '../test/mountView';
import { makeNote, makePet, makeReading } from '../test/fixtures';
import { deferred } from '../test/deferred';
import { touchEvent } from '../test/touch';
import { createTestI18n } from '../test/i18n';
import * as db from '../services/db';
import { closeTopModal } from '../composables/useModal';
import { useReadingsStore } from '../stores/readings';
import { trendReadings } from '../test/trendReadings';
import type { Pet, Reading } from '../types';

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

const pet = makePet();

function mountDetail(location: string, data: MountViewOptions<typeof PetDetailView> = {}) {
  return mountView(PetDetailView, location, { pets: [pet], ...data });
}

const tabs = (wrapper: VueWrapper) => wrapper.findAll('.tab');
const activeTabIndex = (wrapper: VueWrapper) =>
  tabs(wrapper).findIndex((t) => t.classes().includes('active'));

describe('PetDetailView', () => {
  afterEach(() => vi.useRealTimers());

  it('goes home for an unknown pet', async () => {
    const { wrapper, replace } = await mountView(PetDetailView, '/pets/missing');
    expect(replace).toHaveBeenCalledWith({ name: 'home' });
    expect(wrapper.find('.page').exists()).toBe(false);
  });

  it('steps back to home on back when home is the previous screen', async () => {
    const { wrapper, router, push, replace } = await mountDetail('/pets/pet-1');
    router.options.history.state.back = '/';
    const back = vi.spyOn(router, 'back').mockImplementation(() => {});
    await wrapper.get('.back-btn').trigger('click');
    expect(back).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not send the user home after they already left', async () => {
    const load = deferred<Pet[]>();
    vi.spyOn(db, 'getAllPets').mockReturnValueOnce(load.promise);
    const { push, wrapper, replace } = await mountView(PetDetailView, '/pets/missing');
    wrapper.unmount();
    load.resolve([]);
    await settle();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
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

  it('marks up the tabs and panels as a tablist', async () => {
    const { wrapper } = await mountDetail('/pets/pet-1?tab=readings', {
      readings: [makeReading(), makeReading({ id: 'r2' })],
    });
    const textOf = (id: string | null | undefined) =>
      id && document.getElementById(id)?.textContent;
    const tablist = wrapper.get('.tabs');
    expect(tablist.attributes('role')).toBe('tablist');
    expect(textOf(tablist.attributes('aria-labelledby'))).toBe(pet.name);
    const panelNames: (string | null | undefined)[] = [];
    tabs(wrapper).forEach((tab, i) => {
      expect(tab.attributes('role')).toBe('tab');
      expect(tab.attributes('aria-selected')).toBe(String(i === 1));
      expect(tab.attributes('tabindex')).toBe(i === 1 ? '0' : '-1');
      const panel = document.getElementById(tab.attributes('aria-controls')!);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      // Named after the tab without its count
      const labelId = panel?.getAttribute('aria-labelledby');
      expect(tab.element.contains(document.getElementById(labelId!))).toBe(true);
      panelNames.push(textOf(labelId)?.trim());
    });
    expect(panelNames).toEqual(['Chart', 'Readings', 'Notes']);
    expect(wrapper.get('.tab-indicator').attributes('aria-hidden')).toBe('true');
  });

  it('lets the list panels take focus, as they may hold only text', async () => {
    const { wrapper } = await mountDetail('/pets/pet-1');
    const tabindex = (id: string) =>
      wrapper.get(`[role="tabpanel"]#${id}`).attributes('tabindex');
    const ids = tabs(wrapper).map((t) => CSS.escape(t.attributes('aria-controls')!));
    // The chart panel starts with its range buttons, so it needs no tab stop of its own
    expect(ids.map(tabindex)).toEqual([undefined, '0', '0']);
  });

  it('moves between tabs with the arrow keys, Home and End', async () => {
    const { wrapper, replace } = await mountDetail('/pets/pet-1');
    const keydown = (key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      tabs(wrapper)[0].element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // Unhandled keys keep their default action (Tab still leaves the tablist)
    expect(keydown('ArrowRight', { altKey: true })).toBe(false);
    expect(keydown('a')).toBe(false);
    expect(keydown('Tab')).toBe(false);
    await settle();
    expect(replace).not.toHaveBeenCalled();
    const press = async (key: string) => {
      await wrapper.get('.tab:focus').trigger('keydown', { key });
      await settle();
    };
    (tabs(wrapper)[0].element as HTMLElement).focus();

    // Handled keys don't also scroll the page
    expect(keydown('ArrowRight')).toBe(true);
    await settle();
    expect(replace).toHaveBeenLastCalledWith({ query: { tab: 'readings' } });
    expect(document.activeElement).toBe(tabs(wrapper)[1].element);
    expect(tabs(wrapper)[1].attributes('aria-selected')).toBe('true');
    expect(tabs(wrapper)[1].attributes('tabindex')).toBe('0');

    expect(keydown('End')).toBe(true);
    await settle();
    expect(document.activeElement).toBe(tabs(wrapper)[2].element);
    await press('ArrowRight'); // wraps
    expect(document.activeElement).toBe(tabs(wrapper)[0].element);
    await press('ArrowLeft'); // wraps
    expect(document.activeElement).toBe(tabs(wrapper)[2].element);
    await press('Home');
    expect(document.activeElement).toBe(tabs(wrapper)[0].element);
    expect(activeTabIndex(wrapper)).toBe(0);
    const visited = replace.mock.calls.map(([to]) => (to as { query: { tab: string } }).query.tab);
    expect(visited).toEqual(['readings', 'notes', 'chart', 'notes', 'chart']);
  });

  it('follows the focused tab when keys come faster than navigation', async () => {
    const { wrapper, replace } = await mountDetail('/pets/pet-1');
    (tabs(wrapper)[0].element as HTMLElement).focus();
    await tabs(wrapper)[0].trigger('keydown', { key: 'ArrowRight' });
    await tabs(wrapper)[1].trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs(wrapper)[2].element);
    await settle();
    expect(replace).toHaveBeenLastCalledWith({ query: { tab: 'notes' } });
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
      const { wrapper, replace } = await mountDetail('/pets/pet-1');
      await wrapper.get('.icon-btn.danger').trigger('click');
      document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
      await settle();
      expect(usePetsStore().pets).toEqual([]);
      expect(replace).toHaveBeenCalledWith({ name: 'home' });
    });

    it('keeps the pet and returns focus to the delete button on cancel', async () => {
      const { wrapper, push, replace } = await mountDetail('/pets/pet-1');
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
      expect(replace).not.toHaveBeenCalled();
    });
    it('reports a failed delete, keeps the pet and returns focus', async () => {
      vi.spyOn(db, 'deletePetCascade').mockRejectedValueOnce(new Error('quota'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper, push, replace } = await mountDetail('/pets/pet-1');
      const remove = wrapper.get('.icon-btn.danger');
      (remove.element as HTMLElement).focus();
      await remove.trigger('click');
      document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
      await settle();

      expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
      expect(document.activeElement).toBe(remove.element);
      expect(wrapper.get('[role="alert"]').text()).toContain('could not be deleted. Your data has not been changed.');
      expect(usePetsStore().pets).toHaveLength(1);
      expect(error).toHaveBeenCalledWith('Deleting pet failed', expect.any(Error));
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it('deletes on a retry after a failed delete', async () => {
      vi.spyOn(db, 'deletePetCascade').mockRejectedValueOnce(new Error('quota'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper, replace } = await mountDetail('/pets/pet-1');
      for (let attempt = 0; attempt < 2; attempt++) {
        await wrapper.get('.icon-btn.danger').trigger('click');
        document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
        await settle();
      }
      expect(usePetsStore().pets).toEqual([]);
      expect(replace).toHaveBeenCalledWith({ name: 'home' });
    });

    it('deletes once when confirm is clicked twice', async () => {
      const pending = deferred<void>();
      const deleteCascade = vi.spyOn(db, 'deletePetCascade').mockReturnValue(pending.promise);
      const { wrapper } = await mountDetail('/pets/pet-1');
      await wrapper.get('.icon-btn.danger').trigger('click');
      const confirm = document.body.querySelector<HTMLButtonElement>('.btn-confirm')!;
      confirm.click();
      confirm.click();
      pending.resolve();
      await settle();
      expect(deleteCascade).toHaveBeenCalledTimes(1);
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
    const { wrapper, push, replace } = await mountDetail('/pets/pet-1');
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await wrapper.get('.back-btn').trigger('click');
    expect(replace).toHaveBeenCalledWith({ name: 'home' });
    expect(error).toHaveBeenCalledWith('Loading pet failed', expect.any(Error));
  });

  it.each([
    ['readings', 'getReadingsForPet'],
    ['notes', 'getNotesForPet'],
  ] as const)('shows the pet with an alert when its %s fail to load', async (what, method) => {
    vi.spyOn(db, method).mockRejectedValueOnce(new Error('idb broken'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper, push, replace } = await mountDetail('/pets/pet-1', {
      readings: [makeReading()],
      notes: [makeNote()],
    });
    expect(wrapper.find('.icon-btn.danger').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(error).toHaveBeenCalledWith(`Loading ${what} failed`, expect.any(Error));
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
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

    it('exposes the selected range as pressed buttons in a labelled group', async () => {
      const { wrapper, range } = await mountChart();
      const group = wrapper.get('.range-toggle');
      expect(group.attributes('role')).toBe('group');
      expect(group.attributes('aria-label')).toBe('Time range');
      const pressed = () => group.findAll('button').map((b) => b.attributes('aria-pressed'));
      expect(pressed()).toEqual(['true', 'false', 'false']);
      await range(1);
      expect(pressed()).toEqual(['false', 'true', 'false']);
    });

    it('labels the jump picker and closes it with Escape', async () => {
      const { wrapper, range } = await mountChart();
      await range(1);
      const trigger = wrapper.get('.range-label-btn');
      expect(trigger.attributes('aria-expanded')).toBe('false');
      await trigger.trigger('click');
      expect(trigger.attributes('aria-expanded')).toBe('true');
      const arrows = wrapper.findAll('.jump-nav-arrow').map((b) => b.attributes('aria-label'));
      expect(arrows).toEqual(['Previous year', 'Next year']);
      const current = wrapper.findAll('.jump-month-btn[aria-current="true"]');
      expect(current.map((m) => m.text())).toEqual(['Mar']);

      // A month button may be disabled before the readings load; the picker never is
      await wrapper.get('.jump-picker').trigger('keydown', { key: 'Escape' });
      expect(wrapper.find('.jump-picker').exists()).toBe(false);
      expect(trigger.attributes('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger.element);
    });

    it('closes the jump picker on the Android back button, which it leaves alone once closed', async () => {
      const { wrapper, range } = await mountChart();
      await range(1);
      const trigger = wrapper.get('.range-label-btn');
      await trigger.trigger('click');
      expect(closeTopModal()).toBe(true);
      await nextTick();
      expect(wrapper.find('.jump-picker').exists()).toBe(false);
      expect(document.activeElement).toBe(trigger.element);
      expect(closeTopModal()).toBe(false);
    });

    it('ties the jump picker to its trigger while open', async () => {
      const { wrapper, range } = await mountChart();
      await range(1);
      const trigger = wrapper.get('.range-label-btn');
      expect(trigger.attributes('aria-controls')).toBeUndefined();
      await trigger.trigger('click');
      const id = wrapper.get('.jump-picker').attributes('id');
      expect(id).toBeTruthy();
      expect(trigger.attributes('aria-controls')).toBe(id);
    });

    it('closes the jump picker when focus leaves it, not inside or nowhere', async () => {
      const { wrapper, range } = await mountChart();
      await range(1);
      const trigger = wrapper.get('.range-label-btn');
      await trigger.trigger('click');
      const month = wrapper.get('.jump-month-btn[aria-current]');
      await month.trigger('focusout', { relatedTarget: trigger.element });
      await month.trigger('focusout', { relatedTarget: null });
      expect(wrapper.find('.jump-picker').exists()).toBe(true);

      const outside = wrapper.get('.today-btn').element as HTMLElement;
      outside.focus();
      await month.trigger('focusout', { relatedTarget: outside });
      expect(wrapper.find('.jump-picker').exists()).toBe(false);
      expect(trigger.attributes('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(outside);
    });

    it.each([
      ['a pick', '.jump-month-btn[aria-current]'],
      ['a backdrop click', '.jump-backdrop'],
    ])('returns focus to the jump picker trigger on %s', async (_, target) => {
      const { wrapper, range } = await mountChart();
      await range(1);
      const trigger = wrapper.get('.range-label-btn');
      await trigger.trigger('click');
      await wrapper.get(target).trigger('click');
      expect(wrapper.find('.jump-picker').exists()).toBe(false);
      expect(document.activeElement).toBe(trigger.element);
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

  describe('swipe', () => {
    // happy-dom has no layout, so the viewport gets a fixed width.
    const WIDTH = 400; // a drag commits past 25%: 100px

    async function mountSwipe(tab = 'chart') {
      const mounted = await mountDetail(`/pets/pet-1?tab=${tab}`);
      const { wrapper } = mounted;
      const viewport = wrapper.get('.tab-viewport').element;
      Object.defineProperty(viewport, 'clientWidth', { value: WIDTH });

      // Fingers start at (200, 100); dx/dy are relative to that, `time` is in ms.
      async function fire(type: string, dx: number, dy: number, time: number, fingers = 1) {
        const points = Array.from({ length: fingers }, () => ({
          clientX: 200 + dx,
          clientY: 100 + dy,
        }));
        viewport.dispatchEvent(touchEvent(type, points, time));
        await nextTick();
      }
      const start = (time = 0, fingers = 1) => fire('touchstart', 0, 0, time, fingers);
      const move = (dx: number, dy = 0, time = 0) => fire('touchmove', dx, dy, time);
      const end = (dx: number, dy = 0, time = 0) => fire('touchend', dx, dy, time);
      /** A one-finger horizontal swipe by `dx` px that lifts after `ms`. */
      async function swipe(dx: number, ms: number) {
        await start();
        await move(dx, 0, ms / 2);
        await end(dx, 0, ms);
        await settle();
      }

      const track = () => wrapper.get('.tab-track');
      const transform = () => track().attributes('style');
      const dragging = () => track().classes().includes('dragging');
      const collapsed = () =>
        wrapper.findAll('.tab-panel').map((p) => p.classes().includes('collapsed'));
      return { ...mounted, fire, start, move, end, swipe, transform, dragging, collapsed };
    }

    it('moves to the next tab after a slow drag past a quarter of the width', async () => {
      const { swipe, replace, wrapper, transform } = await mountSwipe();
      await swipe(-120, 2000);
      expect(replace).toHaveBeenCalledWith({ query: { tab: 'readings' } });
      expect(activeTabIndex(wrapper)).toBe(1);
      expect(transform()).toContain('translateX(calc(-100% + 0px))');
    });

    it('snaps back after a slow drag of less than a quarter of the width', async () => {
      const { swipe, replace, wrapper, transform, dragging } = await mountSwipe();
      await swipe(-80, 2000);
      expect(replace).not.toHaveBeenCalled();
      expect(activeTabIndex(wrapper)).toBe(0);
      expect(transform()).toContain('translateX(calc(0% + 0px))');
      expect(dragging()).toBe(false);
    });

    it('commits a slow drag only once it is past a quarter of the width', async () => {
      const exact = await mountSwipe();
      await exact.swipe(-100, 2000);
      expect(exact.replace).not.toHaveBeenCalled();

      const past = await mountSwipe();
      await past.swipe(-101, 2000);
      expect(past.replace).toHaveBeenCalledWith({ query: { tab: 'readings' } });
    });

    it('moves to the previous tab on a quick short flick', async () => {
      const { swipe, replace, wrapper } = await mountSwipe('readings');
      await swipe(40, 100); // 0.4 px/ms
      expect(replace).toHaveBeenCalledWith({ query: { tab: 'chart' } });
      expect(activeTabIndex(wrapper)).toBe(0);
    });

    it('snaps back after a short drag that is too slow to be a flick', async () => {
      const { swipe, replace, wrapper } = await mountSwipe('readings');
      await swipe(40, 200); // 0.2 px/ms
      expect(replace).not.toHaveBeenCalled();
      expect(activeTabIndex(wrapper)).toBe(1);
    });

    it('counts a short drag as a flick only when faster than 0.3 px/ms', async () => {
      const exact = await mountSwipe();
      await exact.swipe(-30, 100);
      expect(exact.replace).not.toHaveBeenCalled();

      const faster = await mountSwipe();
      await faster.swipe(-31, 100);
      expect(faster.replace).toHaveBeenCalledWith({ query: { tab: 'readings' } });
    });

    it('moves the track and the tab indicator with the finger, without transitions', async () => {
      const { wrapper, start, move, transform, dragging, collapsed } = await mountSwipe('readings');
      await start();
      await move(-15);
      expect(dragging()).toBe(true);
      expect(transform()).toContain('translateX(calc(-100% + -15px))');
      // Both neighbours stay rendered so either can slide in under the finger.
      expect(collapsed()).toEqual([false, false, false]);
      await move(-50);
      expect(transform()).toContain('translateX(calc(-100% + -50px))');
      const indicator = wrapper.get('.tab-indicator');
      expect(indicator.classes()).toContain('dragging');
      // Tab 1, dragged an eighth of the width towards tab 2.
      expect(indicator.attributes('style')).toContain('translateX(112.5%)');
    });

    it('resists dragging past the first and the last tab, and stays there', async () => {
      const first = await mountSwipe('chart');
      await first.start();
      await first.move(100);
      expect(first.transform()).toContain('translateX(calc(0% + 30px))');
      await first.end(100, 0, 50);
      await settle();
      expect(first.replace).not.toHaveBeenCalled();
      expect(first.transform()).toContain('translateX(calc(0% + 0px))');

      const last = await mountSwipe('notes');
      await last.start();
      await last.move(-100);
      expect(last.transform()).toContain('translateX(calc(-200% + -30px))');
      await last.end(-100, 0, 50);
      await settle();
      expect(last.replace).not.toHaveBeenCalled();
      expect(last.transform()).toContain('translateX(calc(-200% + 0px))');
    });

    it('starts dragging sideways once the finger has moved 10px', async () => {
      const { start, move, transform, dragging } = await mountSwipe();
      await start();
      await move(-10);
      expect(dragging()).toBe(true);
      expect(transform()).toContain('translateX(calc(0% + -10px))');
    });

    it('does not drag a vertical gesture, even after a small sideways jitter', async () => {
      const { start, move, end, replace, transform, dragging } = await mountSwipe();
      await start();
      await move(-9); // under the 10px lock threshold: no axis yet
      expect(dragging()).toBe(false);
      await move(-9, 40); // locks to vertical scrolling
      await move(-200, 40);
      expect(dragging()).toBe(false);
      expect(transform()).toContain('translateX(calc(0% + 0px))');
      await end(-200, 40, 2000);
      await settle();
      expect(replace).not.toHaveBeenCalled();
    });

    it('cancels the drag when a second finger touches', async () => {
      const { start, move, end, replace, transform, dragging } = await mountSwipe();
      await start();
      await move(-100);
      await start(500, 2);
      expect(dragging()).toBe(false);
      expect(transform()).toContain('translateX(calc(0% + 0px))');

      await move(-200, 0, 600);
      expect(transform()).toContain('translateX(calc(0% + 0px))');
      await end(-200, 0, 700);
      await settle();
      expect(dragging()).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('resets the track when the touch is cancelled', async () => {
      const { start, move, fire, replace, transform, dragging } = await mountSwipe();
      await start();
      await move(-150);
      await fire('touchcancel', -150, 0, 100);
      await settle();
      expect(dragging()).toBe(false);
      expect(transform()).toContain('translateX(calc(0% + 0px))');
      expect(replace).not.toHaveBeenCalled();
    });

    it('ignores swipes while the jump picker is open', async () => {
      const { wrapper, swipe, replace, dragging } = await mountSwipe();
      await wrapper.get('.range-label-btn').trigger('click');
      expect(wrapper.find('.jump-picker').exists()).toBe(true);
      await swipe(-150, 100);
      expect(dragging()).toBe(false);
      expect(replace).not.toHaveBeenCalled();
      expect(activeTabIndex(wrapper)).toBe(0);
    });

    it('closes the jump picker when the tab changes', async () => {
      const { wrapper } = await mountSwipe();
      await wrapper.get('.range-label-btn').trigger('click');
      expect(wrapper.find('.jump-picker').exists()).toBe(true);
      await tabs(wrapper)[1].trigger('click');
      await settle();
      expect(activeTabIndex(wrapper)).toBe(1);
      expect(wrapper.find('.jump-picker').exists()).toBe(false);
    });

    it('keeps the panels expanded until the track itself finishes sliding', async () => {
      const { wrapper, swipe, collapsed } = await mountSwipe();
      expect(collapsed()).toEqual([false, true, true]);
      await swipe(-120, 2000);
      expect(collapsed()).toEqual([false, false, false]);

      // A transition inside a panel bubbles up but is not the slide.
      await wrapper.findAll('.tab-panel')[1].trigger('transitionend');
      expect(collapsed()).toEqual([false, false, false]);

      await wrapper.get('.tab-track').trigger('transitionend');
      expect(collapsed()).toEqual([true, false, true]);
    });

    it('keeps the panels expanded while a tapped tab slides in', async () => {
      const { wrapper, collapsed } = await mountSwipe();
      await tabs(wrapper)[1].trigger('click');
      await settle();
      expect(collapsed()).toEqual([false, false, false]);
      await wrapper.get('.tab-track').trigger('transitionend');
      expect(collapsed()).toEqual([true, false, true]);
    });

    it('keeps the panels expanded while the track snaps back', async () => {
      const { wrapper, swipe, collapsed } = await mountSwipe();
      await swipe(-80, 2000);
      expect(collapsed()).toEqual([false, false, false]);
      await wrapper.get('.tab-track').trigger('transitionend');
      expect(collapsed()).toEqual([false, true, true]);
    });

    it('collapses the panels at once when a drag is released where it started', async () => {
      // The track does not move, so no transitionend will come to collapse them.
      const { start, move, end, collapsed } = await mountSwipe();
      await start();
      await move(-15);
      await move(0);
      await end(0, 0, 2000);
      await settle();
      expect(collapsed()).toEqual([false, true, true]);
    });
  });
  describe('trend alert', () => {
    // Only the clock is faked: fake timers stall fake-indexeddb.
    const today = new Date(2024, 2, 20, 9);

    async function mountTrend(readings: Reading[], petOverrides: Partial<Pet> = {}) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(today);
      return mountDetail('/pets/pet-1', { pets: [makePet(petOverrides)], readings });
    }

    function openTrend(wrapper: VueWrapper) {
      return wrapper.get('.pet-hero .trend-badge').trigger('click');
    }
    const dialog = () => document.body.querySelector('[role="dialog"]');

    it('shows a badge under the header that opens the explanation', async () => {
      const { wrapper } = await mountTrend(trendReadings(today, 20, [28, 28]));
      const badge = wrapper.get('.pet-hero .trend-badge');
      expect(badge.text()).toBe('Trending up');
      expect(badge.attributes('aria-haspopup')).toBe('dialog');
      expect(dialog()).toBeNull();

      await openTrend(wrapper);
      expect(dialog()!.querySelector('h2')!.textContent).toBe('Breathing rate trending up');
      expect(dialog()!.querySelector('.trend-message')!.textContent).toBe(
        "Ace's resting breathing rate has been about 28 breaths/min over the last 3 days, up from a usual 20.",
      );
      expect(dialog()!.querySelector('.trend-advice')!.textContent).toBe(
        'Measure again while Ace is resting or asleep, and talk to your vet if it stays higher.',
      );
    });

    it("explains days above the pet's Normal ceiling without a baseline", async () => {
      const { wrapper } = await mountTrend(trendReadings(today, null, [30, 30]), { normalCeiling: 28 });
      expect(wrapper.get('.trend-badge').text()).toBe('Above normal');
      await openTrend(wrapper);
      expect(dialog()!.querySelector('h2')!.textContent).toBe('Breathing rate above Normal');
      expect(dialog()!.querySelector('.trend-message')!.textContent).toBe(
        "Ace's resting breathing rate has been above 28 breaths/min on 2 or more of the last 3 days.",
      );
    });

    it.each([
      ['stable readings', trendReadings(today, 20, [20, 22])],
      ['one high day', trendReadings(today, 20, [34])],
      ['no readings', []],
    ])('shows nothing for %s', async (_, readings) => {
      const { wrapper } = await mountTrend(readings);
      expect(wrapper.find('.trend-badge').exists()).toBe(false);
    });

    it('explains how it works in the dialog', async () => {
      const { wrapper } = await mountTrend(trendReadings(today, 20, [28, 28]));
      await openTrend(wrapper);
      expect(dialog()!.querySelector('h3')!.textContent).toBe('How is this worked out?');
      expect(dialog()!.textContent).toContain('compares the last 3 days with the 28 days before them');
      expect(dialog()!.textContent).toContain(
        'on at least 2 of the last 3 days, the rate was 20% and 4 breaths/min or more above the usual rate',
      );
      expect(dialog()!.textContent).toContain('readings on at least 7 of the earlier days');
      expect(dialog()!.textContent).toContain(
        "when at least 2 of the last 3 days were above Ace's Normal ceiling of 30 breaths/min",
      );
      (dialog()!.querySelector('.btn-ok') as HTMLElement).click();
      await nextTick();
      expect(dialog()).toBeNull();
    });

    it('gives way to the error when a reload fails over cached readings, like the card', async () => {
      // The first visit caches the readings; see 'keeps showing a cached pet …' above.
      const first = await mountTrend(trendReadings(today, 20, [28, 28]));
      expect(first.wrapper.find('.trend-badge').exists()).toBe(true);

      vi.spyOn(db, 'getReadingsForPet').mockRejectedValueOnce(new Error('idb broken'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const wrapper = mount(PetDetailView, {
        attachTo: document.body,
        global: { plugins: [first.pinia, first.router, createTestI18n()] },
      });
      await settle();

      expect(tabs(wrapper)[1].get('.tab-count').text()).toBe('12');
      expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
      expect(wrapper.find('.trend-badge').exists()).toBe(false);
    });

    it('still shows when only the notes fail to load', async () => {
      vi.spyOn(db, 'getNotesForPet').mockRejectedValueOnce(new Error('idb broken'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper } = await mountTrend(trendReadings(today, 20, [28, 28]));
      expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
      expect(wrapper.find('.trend-badge').exists()).toBe(true);
    });

    it("explains the pet's own Normal ceiling in the dialog", async () => {
      const { wrapper } = await mountTrend(trendReadings(today, null, [30, 30]), { normalCeiling: 28 });
      await openTrend(wrapper);
      expect(dialog()!.textContent).toContain(
        "above Ace's Normal ceiling of 28 breaths/min",
      );
    });

    it('goes away when a high reading is deleted', async () => {
      const readings = trendReadings(today, 20, [28, 28]);
      const { wrapper, pinia } = await mountTrend(readings);
      expect(wrapper.find('.trend-badge').exists()).toBe(true);
      await useReadingsStore(pinia).removeReading(readings.at(-1)!.id, 'pet-1');
      await settle();
      expect(wrapper.find('.trend-badge').exists()).toBe(false);
    });
  });
});
