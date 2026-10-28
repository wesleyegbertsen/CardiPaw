import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineComponent, h, onMounted } from 'vue';
import { mountView } from './mountView';
import { usePetsStore } from '../stores/pets';
import { makePet } from './fixtures';

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

const Greets = defineComponent({
  props: { name: { type: String, required: true } },
  setup: (props) => () => h('p', `Hi ${props.name}`),
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

  it('passes props to the component', async () => {
    const { wrapper } = await mountView(Greets, '/', { props: { name: 'Ace' } });
    expect(wrapper.text()).toBe('Hi Ace');
  });

  it('checks props against the component at compile time', () => {
    // Never called: vue-tsc fails the build if these calls stop being type errors.
    const misuses = () => {
      // @ts-expect-error `name` must be a string
      void mountView(Greets, '/', { props: { name: 1 } });
      // @ts-expect-error `name` is required
      void mountView(Greets, '/', { props: {} });
    };
    expectTypeOf(misuses).toBeFunction();
  });
});
