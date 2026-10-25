// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import NoteView from './NoteView.vue';
import { useNotesStore } from '../stores/notes';
import * as db from '../services/db';
import { mountView, settle } from '../test/mountView';
import { makeNote, makePet } from '../test/fixtures';
import { deferred } from '../test/deferred';
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

  it('reports a failed delete and keeps the note', async () => {
    vi.spyOn(db, 'deleteNote').mockRejectedValueOnce(new Error('quota'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper, push } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    const remove = wrapper.get('.icon-btn.danger');
    (remove.element as HTMLElement).focus();
    await remove.trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
    await settle();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(remove.element);
    expect(wrapper.get('[role="alert"]').text()).toBe('This could not be deleted. Please try again.');
    expect(wrapper.find('.note-body').exists()).toBe(true);
    expect(error).toHaveBeenCalledWith('Deleting note failed', expect.any(Error));
    expect(push).not.toHaveBeenCalled();
  });

  it('deletes once when confirm is clicked twice', async () => {
    const pending = deferred<void>();
    const deleteNote = vi.spyOn(db, 'deleteNote').mockReturnValue(pending.promise);
    const { wrapper } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    const confirm = document.body.querySelector<HTMLButtonElement>('.btn-confirm')!;
    confirm.click();
    confirm.click();
    pending.resolve();
    await settle();
    expect(deleteNote).toHaveBeenCalledTimes(1);
  });

  it('reports a failed pin and leaves the note unpinned', async () => {
    vi.spyOn(db, 'saveNote').mockRejectedValueOnce(new Error('quota'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    await wrapper.get('[aria-label="Pin note"]').trigger('click');
    await settle();
    expect(wrapper.get('[role="alert"]').text()).toBe('This could not be saved. Please try again.');
    expect(wrapper.find('[aria-label="Pin note"]').exists()).toBe(true);
    expect(error).toHaveBeenCalledWith('Pinning note failed', expect.any(Error));
  });

  it('saves one pin change when pin is clicked twice', async () => {
    const pending = deferred<void>();
    const saveNote = vi.spyOn(db, 'saveNote').mockReturnValueOnce(pending.promise);
    const { wrapper } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    const pin = wrapper.get('[aria-label="Pin note"]');
    await pin.trigger('click');
    await pin.trigger('click');
    pending.resolve();
    await settle();
    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it('ignores pin while a delete is in flight', async () => {
    const pending = deferred<void>();
    vi.spyOn(db, 'deleteNote').mockReturnValueOnce(pending.promise);
    const saveNote = vi.spyOn(db, 'saveNote');
    const { wrapper, push } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
    await wrapper.get('[aria-label="Pin note"]').trigger('click');
    pending.resolve();
    await settle();
    expect(saveNote).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(notesTab);
  });

  it('ignores delete while a pin is in flight', async () => {
    const pending = deferred<void>();
    vi.spyOn(db, 'saveNote').mockReturnValueOnce(pending.promise);
    const deleteNote = vi.spyOn(db, 'deleteNote');
    const { wrapper, push } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    await wrapper.get('[aria-label="Pin note"]').trigger('click');
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-confirm')?.click();
    pending.resolve();
    await settle();
    expect(deleteNote).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Unpin note"]').exists()).toBe(true);
  });

  it('clears a failed delete’s alert after a successful pin', async () => {
    vi.spyOn(db, 'deleteNote').mockRejectedValueOnce(new Error('quota'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper } = await mountView(NoteView, location, {
      pets: [makePet()],
      notes: [makeNote()],
    });
    await wrapper.get('.icon-btn.danger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.btn-confirm')!.click();
    await settle();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);

    await wrapper.get('[aria-label="Pin note"]').trigger('click');
    await settle();
    expect(wrapper.find('[aria-label="Unpin note"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('reports a failed load instead of not-found', async () => {
    vi.spyOn(db, 'getNotesForPet').mockRejectedValueOnce(new Error('idb broken'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper } = await mountView(NoteView, location, { pets: [makePet()] });
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');
    expect(wrapper.find('.not-found').exists()).toBe(false);
    expect(error).toHaveBeenCalledWith('Loading note failed', expect.any(Error));
  });
});
