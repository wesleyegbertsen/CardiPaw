// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import AddEditPetView from './AddEditPetView.vue';
import { usePetsStore } from '../stores/pets';
import { mountView, settle } from '../test/mountView';
import { makePet } from '../test/fixtures';
import type { Pet } from '../types';

enableAutoUnmount(afterEach);

// The date picker has its own tests; here a plain input stands in for it.
const DatePickerStub = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        class: 'date-stub',
        value: props.modelValue,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
      });
  },
});
const stubs = { DatePicker: DatePickerStub, PetPhotoUpload: true };

async function mountForm(location: string, pets: Pet[] = []) {
  const result = await mountView(AddEditPetView, location, { pets, stubs });
  const { wrapper } = result;
  const submit = wrapper.get<HTMLButtonElement>('.submit-btn');
  const fill = async (fields: Record<string, string>) => {
    for (const [selector, value] of Object.entries(fields)) {
      await wrapper.get(selector).setValue(value);
    }
  };
  return { ...result, submit, fill, error: () => thresholdError(wrapper) };
}

/** The threshold message as shown on screen, or undefined when there is none. */
const thresholdError = (wrapper: VueWrapper) => {
  const message = wrapper.find('.threshold-error');
  return message.exists() ? message.text() : undefined;
};

const required = { '#pet-name': 'Luna', '.date-stub': '2020-05-01' };

describe('AddEditPetView', () => {
  describe('adding', () => {
    it('needs a name and a birthdate', async () => {
      const { submit, fill } = await mountForm('/pets/add');
      expect(submit.element.disabled).toBe(true);
      await fill({ '#pet-name': '   ', '.date-stub': '2020-05-01' });
      expect(submit.element.disabled).toBe(true);
      await fill({ '#pet-name': 'Luna', '.date-stub': '' });
      expect(submit.element.disabled).toBe(true);
      await fill(required);
      expect(submit.element.disabled).toBe(false);
    });

    it('saves the trimmed name, leaves blank ceilings unset and opens the pet', async () => {
      const { wrapper, fill, push } = await mountForm('/pets/add');
      const addPet = vi.spyOn(usePetsStore(), 'addPet');
      await fill({ ...required, '#pet-name': '  Luna  ', '#elevated-ceiling': '40' });
      await wrapper.get('form').trigger('submit');
      await settle();

      expect(addPet).toHaveBeenCalledWith({
        name: 'Luna',
        species: 'cat',
        birthdate: '2020-05-01',
        photo: null,
        normalCeiling: undefined,
        elevatedCeiling: 40,
      });
      const [saved] = usePetsStore().pets;
      expect(push).toHaveBeenCalledWith({ name: 'pet', params: { id: saved.id } });
    });

    it('requires the elevated ceiling to be above the normal one, defaults included', async () => {
      const { fill, submit, error } = await mountForm('/pets/add');
      await fill({ ...required, '#normal-ceiling': '30', '#elevated-ceiling': '30' });
      expect(error()).toBe('Elevated ceiling must be higher than normal ceiling (30).');
      expect(submit.element.disabled).toBe(true);

      // Blank normal ceiling: compared against the default of 30.
      await fill({ '#normal-ceiling': '', '#elevated-ceiling': '25' });
      expect(error()).toBe('Elevated ceiling must be higher than normal ceiling (30).');

      await fill({ '#normal-ceiling': '40' });
      expect(error()).toBe('Elevated ceiling must be higher than normal ceiling (40).');

      await fill({ '#normal-ceiling': '', '#elevated-ceiling': '' });
      expect(error()).toBeUndefined();
      expect(submit.element.disabled).toBe(false);
    });

    it('shows the threshold error as text tied to both ceiling inputs', async () => {
      const { wrapper, fill } = await mountForm('/pets/add');
      const inputs = [wrapper.get('#normal-ceiling'), wrapper.get('#elevated-ceiling')];
      for (const input of inputs) {
        expect(input.attributes('aria-invalid')).toBeUndefined();
        expect(input.attributes('aria-describedby')).toBeUndefined();
      }

      await fill({ '#normal-ceiling': '30', '#elevated-ceiling': '30' });
      const message = wrapper.get('.threshold-error');
      expect(message.attributes('role')).toBe('alert');
      expect(message.text()).toBe('Elevated ceiling must be higher than normal ceiling (30).');
      for (const input of inputs) {
        expect(input.attributes('aria-invalid')).toBe('true');
        expect(input.attributes('aria-describedby')).toBe(message.attributes('id'));
      }

      await fill({ '#elevated-ceiling': '31' });
      expect(wrapper.find('.threshold-error').exists()).toBe(false);
      for (const input of inputs) {
        expect(input.attributes('aria-invalid')).toBeUndefined();
        expect(input.attributes('aria-describedby')).toBeUndefined();
      }
    });

    it('marks only the out-of-range ceiling as invalid', async () => {
      const { wrapper, fill } = await mountForm('/pets/add');
      await fill({ '#normal-ceiling': '250', '#elevated-ceiling': '300' });
      expect(wrapper.get('#normal-ceiling').attributes('aria-invalid')).toBe('true');
      expect(wrapper.get('#elevated-ceiling').attributes('aria-invalid')).toBe('true');

      await fill({ '#normal-ceiling': '250', '#elevated-ceiling': '40' });
      expect(wrapper.get('#normal-ceiling').attributes('aria-invalid')).toBe('true');
      expect(wrapper.get('#elevated-ceiling').attributes('aria-invalid')).toBeUndefined();
    });

    it.each(['0', '-5', '12.5', '250'])('blocks saving a ceiling of %s', async (value) => {
      const { wrapper, fill, submit, error } = await mountForm('/pets/add');
      const addPet = vi.spyOn(usePetsStore(), 'addPet');
      await fill({ ...required, '#normal-ceiling': value, '#elevated-ceiling': '' });
      expect(error()).toBe('Ceilings must be whole numbers from 1 to 200.');
      expect(submit.element.disabled).toBe(true);

      await fill({ '#normal-ceiling': '', '#elevated-ceiling': value });
      expect(error()).toBe('Ceilings must be whole numbers from 1 to 200.');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(addPet).not.toHaveBeenCalled();
    });

    it('goes home on back', async () => {
      const { wrapper, push } = await mountForm('/pets/add');
      await wrapper.get('.back-btn').trigger('click');
      expect(push).toHaveBeenCalledWith({ name: 'home' });
    });
  });

  describe('editing', () => {
    const pet = makePet({ name: 'Ace', species: 'dog', normalCeiling: 25, elevatedCeiling: 40 });

    it('prefills the form and saves the changes', async () => {
      const { wrapper, fill, push } = await mountForm('/pets/pet-1/edit', [pet]);
      expect((wrapper.get('#pet-name').element as HTMLInputElement).value).toBe('Ace');
      expect((wrapper.get('.date-stub').element as HTMLInputElement).value).toBe('2020-01-01');
      expect((wrapper.get('#normal-ceiling').element as HTMLInputElement).value).toBe('25');
      expect((wrapper.get('#elevated-ceiling').element as HTMLInputElement).value).toBe('40');

      const updatePet = vi.spyOn(usePetsStore(), 'updatePet');
      await fill({ '#pet-name': 'Ace II', '#normal-ceiling': '' });
      await wrapper.get('form').trigger('submit');
      await settle();

      expect(updatePet).toHaveBeenCalledWith('pet-1', {
        name: 'Ace II',
        species: 'dog',
        birthdate: '2020-01-01',
        photo: null,
        normalCeiling: undefined,
        elevatedCeiling: 40,
      });
      expect(push).toHaveBeenCalledWith({ name: 'pet', params: { id: 'pet-1' } });
    });

    it('keeps ceilings restored from an older backup saveable until they change', async () => {
      const legacy = makePet({ normalCeiling: 250, elevatedCeiling: 300 });
      const { wrapper, fill, submit, error } = await mountForm('/pets/pet-1/edit', [legacy]);
      const updatePet = vi.spyOn(usePetsStore(), 'updatePet');
      await fill({ '#pet-name': 'Renamed' });
      expect(error()).toBeUndefined();
      await wrapper.get('form').trigger('submit');
      await settle();
      expect(updatePet).toHaveBeenCalledWith(
        'pet-1',
        expect.objectContaining({ name: 'Renamed', normalCeiling: 250, elevatedCeiling: 300 }),
      );

      await fill({ '#normal-ceiling': '251' });
      expect(error()).toBe('Ceilings must be whole numbers from 1 to 200.');
      expect(submit.element.disabled).toBe(true);
    });

    it('goes home for an unknown pet', async () => {
      const { replace } = await mountForm('/pets/missing/edit');
      expect(replace).toHaveBeenCalledWith({ name: 'home' });
    });

    it('goes back to the pet', async () => {
      const { wrapper, push } = await mountForm('/pets/pet-1/edit', [pet]);
      await wrapper.get('.back-btn').trigger('click');
      expect(push).toHaveBeenCalledWith({ name: 'pet', params: { id: 'pet-1' } });
    });
  });
});
