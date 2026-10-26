import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, onMounted } from 'vue';
import { enableAutoUnmount } from '@vue/test-utils';
import { mountView } from './mountView';
import { usePetsStore } from '../stores/pets';
import { makePet } from './fixtures';

enableAutoUnmount(afterEach);

const LoadsPets = defineComponent({
  setup() {
    const petsStore = usePetsStore();
    onMounted(() => petsStore.loadPets());
    return () =>
      h(
        'ul',
        petsStore.pets.map((p) => h('li', p.name)),
      );
  },
});

describe('mountView', () => {
  it('seeds IndexedDB so the real store loads the records', async () => {
    const { wrapper, router } = await mountView(
      LoadsPets,
      { name: 'pet', params: { id: 'a' } },
      { pets: [makePet({ id: 'a', name: 'Ace' }), makePet({ id: 'b', name: 'Bo' })] },
    );
    expect(usePetsStore().pets).toHaveLength(2);
    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(router.currentRoute.value.params.id).toBe('a');
  });
});
