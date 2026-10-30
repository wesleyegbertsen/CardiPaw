import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import AddEditNoteView from './AddEditNoteView.vue';
import * as db from '../services/db';
import { useNotesStore } from '../stores/notes';
import { mountView, settle } from '../test/mountView';
import { deferred } from '../test/deferred';
import { makeNote, makePet } from '../test/fixtures';
import type { Note } from '../types';

vi.mock('../components/LazyRichTextEditor', async () =>
  (await import('../test/stubs')).lazyEditorStubModule(),
);

const NOW = '2024-04-01T10:00:00.000Z';
const notesTab = { name: 'pet', params: { id: 'pet-1' }, query: { tab: 'notes' } };

async function mountNote(location: string, notes: Note[] = []) {
  const result = await mountView(AddEditNoteView, location, { pets: [makePet()], notes });
  return { ...result, submit: result.wrapper.get<HTMLButtonElement>('.submit-btn') };
}

describe('AddEditNoteView', () => {
  beforeEach(() => {
    // Only the clock: faking timers would stall fake-indexeddb.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => vi.useRealTimers());

  describe('adding', () => {
    it('labels the content editor', async () => {
      const { wrapper } = await mountNote('/pets/pet-1/notes/add');
      const id = wrapper.get('.notes-stub').attributes('aria-labelledby');
      expect(id && document.getElementById(id)?.textContent).toBe('Content');
    });

    it('needs a title', async () => {
      const { wrapper, submit } = await mountNote('/pets/pet-1/notes/add');
      expect(submit.element.disabled).toBe(true);
      await wrapper.get('#note-title').setValue('   ');
      expect(submit.element.disabled).toBe(true);
      await wrapper.get('#note-title').setValue('Vet');
      expect(submit.element.disabled).toBe(false);
    });

    it('adds a pinned note and goes to the notes tab', async () => {
      const { wrapper, replace } = await mountNote('/pets/pet-1/notes/add');
      const addNote = vi.spyOn(useNotesStore(), 'addNote');
      await wrapper.get('#note-title').setValue('  Vet visit  ');
      await wrapper.get('.notes-stub').setValue('<p>Checkup</p>');
      await wrapper.get('.header-actions .icon-btn').trigger('click');
      await wrapper.get('form').trigger('submit');
      await settle();

      expect(addNote).toHaveBeenCalledWith({
        petId: 'pet-1',
        title: 'Vet visit',
        content: '<p>Checkup</p>',
        createdAt: NOW,
        pinnedAt: NOW,
      });
      expect(replace).toHaveBeenCalledWith(notesTab);
    });

    it('reports a failed save and stays on the form', async () => {
      vi.spyOn(db, 'saveNote').mockRejectedValueOnce(new Error('quota'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper, submit, replace } = await mountNote('/pets/pet-1/notes/add');
      await wrapper.get('#note-title').setValue('Vet');
      await wrapper.get('form').trigger('submit');
      await settle();
      expect(wrapper.get('.save-error').text()).toBe('This could not be saved. Please try again.');
      expect(error).toHaveBeenCalledWith('Saving note failed', expect.any(Error));
      expect(replace).not.toHaveBeenCalled();
      expect(submit.element.disabled).toBe(false);
    });

    it('reports a failed load and offers no form to save', async () => {
      vi.spyOn(db, 'getAllPets').mockRejectedValueOnce(new Error('idb broken'));
      const save = vi.spyOn(db, 'saveNote');
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper, push, replace } = await mountView(AddEditNoteView, '/pets/pet-1/notes/add', {
        pets: [makePet()],
      });
      expect(wrapper.get('.load-error').text()).toContain('could not be loaded');
      expect(error).toHaveBeenCalledWith('Loading note failed', expect.any(Error));
      expect(wrapper.find('form').exists()).toBe(false);
      expect(save).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('editing', () => {
    const location = '/pets/pet-1/notes/note-1/edit';
    const pinnedAt = '2024-03-20T08:00:00.000Z';

    async function editAndSave(note: Note, togglePin: boolean) {
      const result = await mountNote(location, [note]);
      const updateNote = vi.spyOn(useNotesStore(), 'updateNote');
      await result.wrapper.get('#note-title').setValue('Renamed');
      if (togglePin) await result.wrapper.get('.header-actions .icon-btn').trigger('click');
      await result.wrapper.get('form').trigger('submit');
      await settle();
      return { ...result, updateNote };
    }

    it('prefills the title, content and pin', async () => {
      const { wrapper } = await mountNote(location, [makeNote({ pinnedAt })]);
      expect((wrapper.get('#note-title').element as HTMLInputElement).value).toBe('Vet visit');
      expect((wrapper.get('.notes-stub').element as HTMLTextAreaElement).value).toBe(
        '<p>All good</p>',
      );
      expect(wrapper.get('.header-actions .icon-btn').classes()).toContain('pinned');
    });

    it('keeps the original pin time and sets modifiedAt', async () => {
      const { updateNote, replace } = await editAndSave(makeNote({ pinnedAt }), false);
      expect(updateNote).toHaveBeenCalledWith({
        ...makeNote(),
        title: 'Renamed',
        modifiedAt: NOW,
        pinnedAt,
      });
      expect(replace).toHaveBeenCalledWith({
        name: 'note',
        params: { id: 'pet-1', noteId: 'note-1' },
      });
    });

    it('pins an unpinned note now', async () => {
      const { updateNote } = await editAndSave(makeNote(), true);
      expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ pinnedAt: NOW }));
    });

    it('clears the pin', async () => {
      const { updateNote } = await editAndSave(makeNote({ pinnedAt }), true);
      expect(updateNote.mock.calls[0][0].pinnedAt).toBeUndefined();
    });

    it('reports a failed save of an edit', async () => {
      vi.spyOn(db, 'saveNote').mockRejectedValueOnce(new Error('quota'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper, replace } = await editAndSave(makeNote(), false);
      expect(wrapper.get('.save-error').text()).toBe('This could not be saved. Please try again.');
      expect(replace).not.toHaveBeenCalled();
      expect((wrapper.get('#note-title').element as HTMLInputElement).value).toBe('Renamed');
    });

    it('reports a failed load and offers no form to save', async () => {
      vi.spyOn(db, 'getNotesForPet').mockRejectedValueOnce(new Error('idb broken'));
      const save = vi.spyOn(db, 'saveNote');
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { wrapper, push, replace } = await mountView(AddEditNoteView, location, {
        pets: [makePet()],
        notes: [makeNote()],
      });
      expect(wrapper.get('.load-error').text()).toContain('could not be loaded');
      expect(error).toHaveBeenCalledWith('Loading note failed', expect.any(Error));
      expect(wrapper.find('form').exists()).toBe(false);
      expect(save).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it('goes to the notes tab for an unknown note', async () => {
      const { replace } = await mountNote(location);
      expect(replace).toHaveBeenCalledWith(notesTab);
    });

    it('does not go to the notes tab after the user already left', async () => {
      const load = deferred<Note[]>();
      vi.spyOn(db, 'getNotesForPet').mockReturnValueOnce(load.promise);
      const { push, replace, wrapper } = await mountNote(location);
      wrapper.unmount();
      load.resolve([]);
      await settle();
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it('never adds a note when saved before the note has loaded', async () => {
      let finishLoad!: (notes: Note[]) => void;
      vi.spyOn(db, 'getNotesForPet').mockImplementationOnce(
        () => new Promise<Note[]>((r) => (finishLoad = r)),
      );
      const { wrapper, submit } = await mountNote(location, [makeNote()]);
      const notes = useNotesStore();
      const addNote = vi.spyOn(notes, 'addNote');
      const updateNote = vi.spyOn(notes, 'updateNote');

      await wrapper.get('#note-title').setValue('Typed early');
      // Save looks unavailable rather than silently doing nothing.
      expect(submit.element.disabled).toBe(true);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(addNote).not.toHaveBeenCalled();
      expect(updateNote).not.toHaveBeenCalled();

      finishLoad([makeNote()]);
      await settle();
      expect(submit.element.disabled).toBe(false);
      expect(await db.getAllNotes()).toEqual([makeNote()]);
    });
  });
});
