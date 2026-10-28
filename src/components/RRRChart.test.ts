import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import RRRChart from './RRRChart.vue';
import { createTestI18n } from '../test/i18n';
import { makeReading } from '../test/fixtures';
import type { Reading } from '../types';

vi.mock('vue-chartjs', async () => (await import('../test/stubs')).recordingLineStub());

interface ChartData {
  labels: string[];
  datasets: { data: number[] }[];
}
interface ChartOptions {
  plugins: { tooltip: { callbacks: { label: (ctx: { parsed: { y: number | null } }) => string } } };
  scales: { x: { ticks: { maxTicksLimit: number } } };
}

const readings: Reading[] = [
  makeReading({ id: 'b', date: '2024-03-12T08:00:00.000Z', rate: 26 }),
  makeReading({ id: 'a', date: '2024-03-10T08:00:00.000Z', rate: 20 }),
  makeReading({ id: 'c', date: '2024-03-14T08:00:00.000Z', rate: 33 }),
];

function mountChart(props: { readings: Reading[]; normalCeiling?: number; maxTicks?: number }) {
  const wrapper = mount(RRRChart, { props, global: { plugins: [createTestI18n()] } });
  const line = () => wrapper.getComponent({ name: 'LineChartStub' });
  return {
    wrapper,
    data: () => line().props('data') as ChartData,
    options: () => line().props('options') as ChartOptions,
  };
}

describe('RRRChart', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('shows a message instead of a chart without readings', () => {
    const { wrapper } = mountChart({ readings: [] });
    expect(wrapper.get('.empty').text()).toBe('No readings yet — start tracking to see a chart.');
    expect(wrapper.findComponent({ name: 'LineChartStub' }).exists()).toBe(false);
  });

  it('plots the readings oldest first', () => {
    const { data } = mountChart({ readings });
    expect(data().labels).toEqual(['Mar 10', 'Mar 12', 'Mar 14']);
    expect(data().datasets[0].data).toEqual([20, 26, 33]);
  });

  it('draws the normal line at the default ceiling', () => {
    const { wrapper, data } = mountChart({ readings });
    expect(data().datasets[1].data).toEqual([30, 30, 30]);
    expect(wrapper.get('.legend-item.normal').text()).toBe('- - Normal max (30 breaths/min)');
  });

  it('draws the normal line at the pet’s own ceiling', () => {
    const { wrapper, data } = mountChart({ readings, normalCeiling: 24 });
    expect(data().datasets[1].data).toEqual([24, 24, 24]);
    expect(wrapper.get('.legend-item.normal').text()).toBe('- - Normal max (24 breaths/min)');
  });

  it('labels tooltips in breaths per minute and limits the ticks', () => {
    const { options } = mountChart({ readings, maxTicks: 6 });
    const label = options().plugins.tooltip.callbacks.label;
    expect(label({ parsed: { y: 26 } })).toBe('26 breaths/min');
    expect(label({ parsed: { y: null } })).toBe('0 breaths/min');
    expect(options().scales.x.ticks.maxTicksLimit).toBe(6);
    expect(mountChart({ readings }).options().scales.x.ticks.maxTicksLimit).toBe(8);
  });
});
