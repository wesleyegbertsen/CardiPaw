import { describe, expect, it, vi } from 'vitest';
import ReadingView from './ReadingView.vue';
import { useReadingsStore } from '../stores/readings';
import * as db from '../services/db';
import { mountView, settle } from '../test/mountView';
import { makePet, makeReading } from '../test/fixtures';
import { deferred } from '../test/deferred';
import type { Reading } from '../types';

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

  it.each([
    [makeReading({ durationSeconds: 60 }), 'Guided (60\u00a0s)'],
    [makeReading({ durationSeconds: 15 }), 'Guided (15\u00a0s)'],
    // Saved before the length could be chosen: those all ran for 30 seconds.
    [makeReading(), 'Guided (30\u00a0s)'],
    [makeReading({ source: 'manual' }), 'Manual entry'],
  ])('labels how the reading was taken (%#)', async (reading, label) => {
    const { wrapper } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [reading],
    });
    expect(wrapper.get('.source-chip').text()).toBe(label);
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

  it('returns to the readings tab on back without adding a history entry', async () => {
    const { wrapper, push, replace } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [makeReading()],
    });
    await wrapper.get('.back-btn').trigger('click');
    expect(replace).toHaveBeenCalledWith(readingsTab);
    expect(push).not.toHaveBeenCalled();
  });

  it('deletes the reading after confirming', async () => {
    const { wrapper, replace } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [makeReading()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
    await settle();
    expect(await db.getReadingsForPet('pet-1')).toEqual([]);
    expect(replace).toHaveBeenCalledWith(readingsTab);
  });

  it('keeps the reading on cancel', async () => {
    const { wrapper, push, replace } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [makeReading()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-cancel')!.click();
    await settle();
    expect(useReadingsStore().getReadingsForPet('pet-1')).toHaveLength(1);
    expect(await db.getReadingsForPet('pet-1')).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('reports a failed delete and keeps the reading', async () => {
    vi.spyOn(db, 'deleteReading').mockRejectedValueOnce(new Error('quota'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper, push, replace } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [makeReading()],
    });
    const remove = wrapper.get('.icon-btn.danger');
    (remove.element as HTMLElement).focus();
    await remove.trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
    await settle();

    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(remove.element);
    expect(wrapper.get('[role="alert"]').text()).toBe('This could not be deleted. Please try again.');
    expect(wrapper.find('.reading-body').exists()).toBe(true);
    expect(error).toHaveBeenCalledWith('Deleting reading failed', expect.any(Error));
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('deletes on a retry after a failed delete', async () => {
    vi.spyOn(db, 'deleteReading').mockRejectedValueOnce(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper, replace } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [makeReading()],
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await wrapper.get('.icon-btn.danger').trigger('click');
      document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
      await settle();
    }
    expect(await db.getReadingsForPet('pet-1')).toEqual([]);
    expect(replace).toHaveBeenCalledWith(readingsTab);
  });

  it('deletes once when confirm is clicked twice', async () => {
    const pending = deferred<void>();
    const deleteReading = vi.spyOn(db, 'deleteReading').mockReturnValue(pending.promise);
    const { wrapper } = await mountView(ReadingView, location, {
      pets: [makePet()],
      readings: [makeReading()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    const confirm = document.body.querySelector<HTMLButtonElement>('.btn-confirm')!;
    confirm.click();
    confirm.click();
    pending.resolve();
    await settle();
    expect(deleteReading).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load instead of not-found', async () => {
    vi.spyOn(db, 'getReadingsForPet').mockRejectedValueOnce(new Error('idb broken'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper } = await mountView(ReadingView, location, { pets: [makePet()] });
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(wrapper.find('.not-found').exists()).toBe(false);
    expect(error).toHaveBeenCalledWith('Loading reading failed', expect.any(Error));
  });
});
