// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils';
import ShareView from './ShareView.vue';
import * as codec from '../utils/shareCodec';
import { mountView } from '../test/mountView';
import { makePet, makeReading } from '../test/fixtures';
import type { SharePayload } from '../types';

vi.mock('../utils/shareCodec', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/shareCodec')>();
  return { ...real, decodeShare: vi.fn(real.decodeShare) };
});

enableAutoUnmount(afterEach);

// Chart.js needs a canvas; the view's job is to hand each month its readings.
const RRRChartStub = defineComponent({
  name: 'RRRChartStub',
  props: { readings: { type: Array, required: true }, maxTicks: Number, normalCeiling: Number },
  setup: () => () => h('div', { class: 'chart-stub' }),
});
const stubs = { RRRChart: RRRChartStub, ThemeToggle: true, LocalePicker: true };

const pet = makePet({ name: 'Mimi', species: 'cat', normalCeiling: 20, elevatedCeiling: 25 });
const readings = [
  makeReading({ id: 'a', date: '2024-02-10T08:00:00.000Z', rate: 18, restState: 'resting' }),
  makeReading({ id: 'b', date: '2024-03-12T08:00:00.000Z', rate: 22, restState: 'sleeping' }),
  makeReading({ id: 'c', date: '2024-03-14T08:00:00.000Z', rate: 30, source: 'manual' }),
];

const link = (p = pet) =>
  codec.encodeShare(codec.buildSharePayload(p, readings, ['2024-02', '2024-03']));
// Decoding runs through real compression streams, which can outlast a few ticks.
const loaded = (wrapper: VueWrapper) =>
  vi.waitFor(() => expect(wrapper.find('.status-msg').exists()).toBe(false));

async function mountShare(query: Record<string, string> = {}) {
  const result = await mountView(ShareView, { name: 'share', query }, { stubs });
  await loaded(result.wrapper);
  return result;
}

function deferred() {
  let resolve!: (value: SharePayload) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<SharePayload>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ShareView', () => {
  beforeEach(() => {
    vi.mocked(codec.decodeShare).mockClear();
  });

  it('shows the shared pet, stats and months newest first', async () => {
    const { wrapper } = await mountShare({ d: await link() });
    expect(wrapper.get('.pet-name').text()).toBe('Mimi');
    expect(wrapper.findAll('.stat-value').map((s) => s.text())).toEqual(['3', '23', '18', '30']);
    expect(wrapper.findAll('.status-breakdown .rate-badge').map((b) => b.text())).toEqual([
      '1 Normal',
      '1 Elevated',
      '1 High',
    ]);
    expect(wrapper.findAll('.month-title').map((t) => t.text())).toEqual([
      'March 2024',
      'February 2024',
    ]);
    const charts = wrapper.findAllComponents(RRRChartStub);
    expect(charts.map((c) => c.props('normalCeiling'))).toEqual([20, 20]);
    expect(charts[0].props('readings')).toHaveLength(2);
  });

  it('rates each row against the shared ceilings and shows its tags', async () => {
    const { wrapper } = await mountShare({ d: await link() });
    const rows = wrapper.findAll('.reading-row');
    expect(rows.map((r) => r.get('.row-rate').text().split(' ')[0])).toEqual(['30', '22', '18']);
    expect(rows.map((r) => r.get('.pill-col .rate-badge').classes())).toEqual([
      expect.arrayContaining(['danger']),
      expect.arrayContaining(['warning']),
      expect.arrayContaining(['normal']),
    ]);
    expect(rows[0].find('.source-tag').exists()).toBe(true);
    expect(rows[1].get('.rest-tag').classes()).toContain('sleeping');
    expect(rows[2].get('.rest-tag').classes()).toContain('resting');
  });

  it.each([
    ['missing', {}],
    ['empty', { d: '' }],
    ['garbage', { d: 'not-a-real-link!!' }],
  ])('shows the error card for a %s link', async (_label, query) => {
    const { wrapper } = await mountShare(query);
    expect(wrapper.find('.error-card').exists()).toBe(true);
    expect(wrapper.find('.pet-hero').exists()).toBe(false);
  });

  it('decodes again when the link changes', async () => {
    const { wrapper, router } = await mountShare({ d: await link() });
    await router.push({ name: 'share', query: { d: await link({ ...pet, name: 'Ziggy' }) } });
    await vi.waitFor(() => expect(wrapper.find('.pet-name').text()).toBe('Ziggy'));
  });

  it('keeps the newest link when an older decode finishes last', async () => {
    const [dA, dB] = [await link(), await link({ ...pet, name: 'Ziggy' })];
    const first = deferred();
    const second = deferred();
    const real = await vi.importActual<typeof import('../utils/shareCodec')>('../utils/shareCodec');
    vi.mocked(codec.decodeShare)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { wrapper, router } = await mountView(
      ShareView,
      { name: 'share', query: { d: dA } },
      { stubs },
    );
    await router.push({ name: 'share', query: { d: dB } });
    await flushPromises();

    second.resolve(await real.decodeShare(dB));
    await flushPromises();
    first.resolve(await real.decodeShare(dA));
    await flushPromises();
    expect(wrapper.get('.pet-name').text()).toBe('Ziggy');
  });

  it('ignores an older link that fails after the newest one loaded', async () => {
    const dB = await link({ ...pet, name: 'Ziggy' });
    const first = deferred();
    vi.mocked(codec.decodeShare).mockImplementationOnce(() => first.promise);

    const { wrapper, router } = await mountView(
      ShareView,
      { name: 'share', query: { d: 'older' } },
      { stubs },
    );
    await router.push({ name: 'share', query: { d: dB } });
    await loaded(wrapper);
    first.reject(new codec.ShareDecodeError('truncated'));
    await flushPromises();
    expect(wrapper.find('.error-card').exists()).toBe(false);
    expect(wrapper.get('.pet-name').text()).toBe('Ziggy');
  });
});
