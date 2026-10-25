// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import NoteView from './NoteView.vue';
import { useNotesStore } from '../stores/notes';
import * as db from '../services/db';
import { mountView, settle } from '../test/mountView';
import { makeNote, makePet } from '../test/fixtures';
import type { Note } from '../types';

enableAutoUnmount(afterEach);

const location = '/pets/pet-1/notes/note-1';
const notesTab = { name: 'pet', params: { id: 'pet-1' }, query: { tab: 'notes' } };
const modifiedAt = '2024-03-16T09:00:00.000Z';

describe('NoteView', () => {
  it('shows nothing until the note has loaded', async () => {
    let finishLoad!: (notes: Note[]) => void;
    vi.spyOn(db, 'getNotesForPet').mockImplementationOnce(
      () => new Promise<Note[]>((r) => (finishLoad = r)),
    );
    const { wrapper } = await mountView(NoteView, location, { pets: [makePet()] });
    expect(wrapper.find('.not-found').exists()).toBe(false);
    expect(wrapper.find('.note-body').exists()).toBe(false);

    finishLoad([makeNote()]);
    await settle();
    expect(wrapper.find('.not-found').exists()).toBe(false);
    expect(wrapper.get('.note-body').text()).toContain('Vet visit');
  });

  it('shows not-found without any actions for a missing note', async () => {
    const { wrapper } = await mountView(NoteView, location, { pets: [makePet()] });
    expect(wrapper.get('.not-found').text()).toBe('Note not found.');
    expect(wrapper.findAll('.header-actions button')).toHaveLength(0);
  });

  it('pins and unpins without marking the note as edited', async () => {
    const { wrapper } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote({ modifiedAt })],
    });
    const pin = wrapper.get('[aria-label="Pin note"]');
    await pin.trigger('click');
    await settle();
    const [pinned] = await db.getNotesForPet('pet-1');
    expect(pinned.pinnedAt).toEqual(expect.any(String));
    expect(pinned.modifiedAt).toBe(modifiedAt);

    await wrapper.get('[aria-label="Unpin note"]').trigger('click');
    await settle();
    const [unpinned] = await db.getNotesForPet('pet-1');
    expect(unpinned.pinnedAt).toBeUndefined();
    expect(unpinned.modifiedAt).toBe(modifiedAt);
  });

  it('deletes the note after confirming', async () => {
    const { wrapper, push } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
    await settle();
    expect(await db.getNotesForPet('pet-1')).toEqual([]);
    expect(push).toHaveBeenCalledWith(notesTab);
  });

  it('keeps the note on cancel', async () => {
    const { wrapper, push } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-cancel')!.click();
    await settle();
    expect(useNotesStore().getNotesForPet('pet-1')).toHaveLength(1);
    expect(await db.getNotesForPet('pet-1')).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });
});
