// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import ReadingView from './ReadingView.vue';
import { useReadingsStore } from '../stores/readings';
import * as db from '../services/db';
import { mountView, settle } from '../test/mountView';
import { makePet, makeReading } from '../test/fixtures';
import type { Reading } from '../types';

enableAutoUnmount(afterEach);

const location = '/pets/pet-1/readings/reading-1';
const readingsTab = { name: 'pet', params: { id: 'pet-1' }, query: { tab: 'readings' } };

describe('ReadingView', () => {
  it('shows nothing until the reading has loaded', async () => {
    let finishLoad!: (readings: Reading[]) => void;
    vi.spyOn(db, 'getReadingsForPet').mockImplementationOnce(
      () => new Promise<Reading[]>((r) => (finishLoad = r)),
    );
    const { wrapper } = await mountView(ReadingView, location, { pets: [makePet()] });
    expect(wrapper.find('.not-found').exists()).toBe(false);
    expect(wrapper.find('.reading-body').exists()).toBe(false);

    finishLoad([makeReading()]);
    await settle();
    expect(wrapper.find('.not-found').exists()).toBe(false);
    expect(wrapper.get('.rate-number').text()).toBe('24');
  });

  it('shows not-found without any actions for a missing reading', async () => {
    const { wrapper } = await mountView(ReadingView, location, { pets: [makePet()] });
    expect(wrapper.get('.not-found').text()).toBe('Reading not found.');
    expect(wrapper.findAll('.header-actions button')).toHaveLength(0);
  });

  it('rates the reading against the pet’s own ceilings', async () => {
    const { wrapper } = await mountView(ReadingView, location, {
      pets: [makePet({ normalCeiling: 20, elevatedCeiling: 22 })],
      readings: [makeReading({ rate: 24 })],
    });
    const badge = wrapper.get('.rate-badge');
    expect(badge.classes()).toContain('danger');
    expect(badge.text()).toBe('High');
  });

  it('deletes the reading after confirming', async () => {
    const { wrapper, push } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [makeReading()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
    await settle();
    expect(await db.getReadingsForPet('pet-1')).toEqual([]);
    expect(push).toHaveBeenCalledWith(readingsTab);
  });

  it('keeps the reading on cancel', async () => {
    const { wrapper, push } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [makeReading()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-cancel')!.click();
    await settle();
    expect(useReadingsStore().getReadingsForPet('pet-1')).toHaveLength(1);
    expect(await db.getReadingsForPet('pet-1')).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });
});
