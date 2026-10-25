// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import HomeView from './HomeView.vue';
import * as db from '../services/db';
import { usePetsStore } from '../stores/pets';
import { mountView, settle } from '../test/mountView';
import { makePet } from '../test/fixtures';

vi.mock('vue-chartjs', async () => {
  const { defineComponent, h } = await import('vue');
  return { Line: defineComponent({ render: () => h('canvas') }) };
});

enableAutoUnmount(afterEach);

// App.vue starts the pet load; HomeView only renders the store's state.
async function mountHome(load: () => Promise<unknown>) {
  const result = await mountView(HomeView, '/');
  await load().catch(() => {});
  await settle();
  return result;
}

describe('HomeView', () => {
  it('shows an alert, not the empty state, when pets cannot load', async () => {
    vi.spyOn(db, 'getAllPets').mockRejectedValue(new Error('idb broken'));
    const { wrapper } = await mountHome(() => usePetsStore().loadPets());
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('could not be loaded');
    expect(wrapper.text()).not.toContain('No pets yet');
  });

  it('still lists a pet added after the load failed', async () => {
    vi.spyOn(db, 'getAllPets').mockRejectedValue(new Error('idb broken'));
    const { wrapper } = await mountHome(() => usePetsStore().loadPets());
    await usePetsStore().addPet({ name: 'Luna', species: 'cat', birthdate: '2020-05-01', photo: null });
    await settle();
    expect(usePetsStore().loadError).toBe(true);
    expect(wrapper.findAll('.pet-card')).toHaveLength(1);
    expect(wrapper.text()).toContain('Luna');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('shows the empty state when there are no pets', async () => {
    vi.spyOn(db, 'getAllPets').mockResolvedValue([]);
    const { wrapper } = await mountHome(() => usePetsStore().loadPets());
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('No pets yet');
  });

  it('lists a card per pet', async () => {
    vi.spyOn(db, 'getAllPets').mockResolvedValue([
      makePet({ id: 'a', name: 'Ace' }),
      makePet({ id: 'b', name: 'Bo' }),
    ]);
    const { wrapper } = await mountHome(() => usePetsStore().loadPets());
    expect(wrapper.findAll('.pet-card')).toHaveLength(2);
    expect(wrapper.text()).toContain('Your pets');
  });

  it('opens the add-pet form from the button', async () => {
    const { wrapper, push } = await mountHome(async () => {});
    await wrapper.get('.fab').trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'pet-add' });
  });
});
