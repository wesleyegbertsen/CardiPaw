import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import PetCard from './PetCard.vue';
import { useReadingsStore } from '../stores/readings';
import * as db from '../services/db';
import { createTestI18n } from '../test/i18n';
import { makePet, makeReading } from '../test/fixtures';
import { trendReadings } from '../test/trendReadings';
import type { Reading } from '../types';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('vue-chartjs', async () => (await import('../test/stubs')).recordingLineStub());

const profile = { name: 'pet', params: { id: 'pet-1' } };
const tracker = { name: 'tracker', params: { id: 'pet-1' } };

async function mountCard(name = 'Ace', readings: Reading[] = [], pinia = createPinia()) {
  await db.importAllData({ version: 1, exportedAt: '', pets: [], readings, notes: [] });
  const wrapper = mount(PetCard, {
    props: { pet: makePet({ name }) },
    attachTo: document.body,
    global: { plugins: [pinia, createTestI18n()] },
  });
  await flushPromises();
  return wrapper;
}

function press(el: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe('PetCard', () => {
  beforeEach(() => push.mockClear());
  afterEach(() => vi.useRealTimers());

  it('opens the profile on click, Enter and Space, and keeps Space from scrolling', async () => {
    const card = (await mountCard()).get('.pet-card');
    await card.trigger('click');
    press(card.element, 'Enter');
    const space = press(card.element, ' ');
    expect(push.mock.calls).toEqual([[profile], [profile], [profile]]);
    expect(space.defaultPrevented).toBe(true);
  });

  it('leaves Enter and Space on the track button to the button', async () => {
    const button = (await mountCard()).get('.track-btn').element;
    press(button, 'Enter');
    const space = press(button, ' ');
    expect(push).not.toHaveBeenCalledWith(profile);
    expect(space.defaultPrevented).toBe(false);
  });

  it('opens only the tracker when the track button is clicked', async () => {
    await (await mountCard()).get('.track-btn').trigger('click');
    expect(push.mock.calls).toEqual([[tracker]]);
  });

  it('says the readings could not be loaded instead of "No readings yet"', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('blocked');
    vi.spyOn(db, 'getReadingsForPet').mockRejectedValueOnce(failure);
    const wrapper = await mountCard();
    expect(wrapper.text()).not.toContain('No readings yet');
    const message = wrapper.get('.readings-error');
    expect(message.text()).toBe('Readings could not be loaded');
    // The card is a role="button" with its own label, so its text is not read out; describe it.
    expect(wrapper.get('.pet-card').attributes('aria-describedby')).toBe(message.attributes('id'));
    expect(error).toHaveBeenCalledWith('Loading readings failed', failure);
  });

  it('has no description while the readings load fine', async () => {
    const wrapper = await mountCard();
    expect(wrapper.find('.readings-error').exists()).toBe(false);
    expect(wrapper.get('.pet-card').attributes('aria-describedby')).toBeUndefined();
    expect(wrapper.get('.last-measured').text()).toBe('No readings yet');
  });

  it('shows a safe initial for blank and emoji names', async () => {
    expect((await mountCard('')).get('.placeholder-initial').text()).toBe('?');
    expect((await mountCard('🐱Mimi')).get('.placeholder-initial').text()).toBe('🐱');
  });

  describe('sparkline', () => {
    beforeEach(() => {
      // Only the clock: faking timers would stall fake-indexeddb.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2024-03-15T18:00:00.000Z'));
    });

    it('stays hidden with fewer than two days of readings', async () => {
      const wrapper = await mountCard('Ace', [
        makeReading({ id: 'a', date: '2024-03-15T08:00:00.000Z', rate: 20 }),
        makeReading({ id: 'b', date: '2024-03-15T09:00:00.000Z', rate: 30 }),
      ]);
      expect(wrapper.find('.sparkline-wrap').exists()).toBe(false);
    });

    it('plots rounded daily averages with 5 breaths of headroom', async () => {
      const wrapper = await mountCard('Ace', [
        makeReading({ id: 'a', date: '2024-03-13T08:00:00.000Z', rate: 3 }),
        makeReading({ id: 'b', date: '2024-03-15T08:00:00.000Z', rate: 20 }),
        makeReading({ id: 'c', date: '2024-03-15T09:00:00.000Z', rate: 25 }),
      ]);
      const line = wrapper.getComponent({ name: 'LineChartStub' });
      const data = line.props('data') as { labels: string[]; datasets: { data: unknown[] }[] };
      expect(data.labels).toHaveLength(7);
      expect(data.labels.at(-1)).toBe('2024-03-15');
      expect(data.datasets[0].data).toEqual([null, null, null, null, 3, null, 23]);
      const options = line.props('options') as { scales: { y: { min: number; max: number } } };
      expect(options.scales.y).toMatchObject({ min: 0, max: 28 });
    });

    it('stays hidden next to the error when a reload fails over cached readings', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const pinia = createPinia();
      // Readings cached by an earlier visit, so the sparkline would have data to draw.
      useReadingsStore(pinia).readingsByPet['pet-1'] = [
        makeReading({ id: 'a', date: '2024-03-13T08:00:00.000Z', rate: 20 }),
        makeReading({ id: 'b', date: '2024-03-15T08:00:00.000Z', rate: 25 }),
      ];
      vi.spyOn(db, 'getReadingsForPet').mockRejectedValueOnce(new Error('blocked'));
      const wrapper = await mountCard('Ace', [], pinia);
      expect(wrapper.get('.readings-error').text()).toBe('Readings could not be loaded');
      expect(wrapper.find('.sparkline-wrap').exists()).toBe(false);
    });
  });
  describe('trend', () => {
    const today = new Date(2024, 2, 20, 9);
    beforeEach(() => {
      // Only the clock: faking timers would stall fake-indexeddb.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(today);
    });

    it('flags a rising trend and describes the card with it', async () => {
      const wrapper = await mountCard('Ace', trendReadings(today, 20, [28, 28]));
      const badge = wrapper.get('.trend-row .badge.trend');
      expect(badge.text()).toBe('Trending up');
      expect(wrapper.get('.pet-card').attributes('aria-describedby')).toBe(badge.attributes('id'));
    });

    it('names days above the Normal ceiling as such', async () => {
      const wrapper = await mountCard('Ace', trendReadings(today, null, [34, 34]));
      expect(wrapper.get('.badge.trend').text()).toBe('Above normal');
    });

    it('shows nothing for stable readings', async () => {
      const wrapper = await mountCard('Ace', trendReadings(today, 20, [20, 22]));
      expect(wrapper.find('.badge.trend').exists()).toBe(false);
      expect(wrapper.get('.pet-card').attributes('aria-describedby')).toBeUndefined();
    });

    it('appears when a second high day is added', async () => {
      const pinia = createPinia();
      const wrapper = await mountCard('Ace', trendReadings(today, 20, [28]), pinia);
      expect(wrapper.find('.badge.trend').exists()).toBe(false);
      await useReadingsStore(pinia).addReading({
        petId: 'pet-1', date: new Date(2024, 2, 19, 12).toISOString(), rate: 28, clickCount: 14,
      });
      await flushPromises();
      expect(wrapper.find('.badge.trend').exists()).toBe(true);
    });

    it('gives way to the error when a reload fails over cached readings', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const pinia = createPinia();
      useReadingsStore(pinia).readingsByPet['pet-1'] = trendReadings(today, 20, [28, 28]);
      vi.spyOn(db, 'getReadingsForPet').mockRejectedValueOnce(new Error('blocked'));
      const wrapper = await mountCard('Ace', [], pinia);
      expect(wrapper.find('.badge.trend').exists()).toBe(false);
      expect(wrapper.get('.pet-card').attributes('aria-describedby')).toBe(wrapper.get('.readings-error').attributes('id'));
    });
  });
});
