// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { enableAutoUnmount, mount, RouterLinkStub } from '@vue/test-utils';
import ReadingList from './ReadingList.vue';
import NoteList from './NoteList.vue';
import { createTestI18n } from '../test/i18n';
import { installIntersectionObserver } from '../test/intersectionObserver';
import { makeNote, makePet, makeReading } from '../test/fixtures';

enableAutoUnmount(afterEach);

const global = () => ({
  plugins: [createTestI18n()],
  stubs: { RouterLink: RouterLinkStub },
});

const readings = (n: number) =>
  Array.from({ length: n }, (_, i) => makeReading({ id: `r${i}`, rate: 20 + (i % 10) }));
const notes = (n: number, pinned = 0) =>
  Array.from({ length: n }, (_, i) =>
    makeNote({
      id: `n${i}`,
      title: `Note ${i}`,
      ...(i < pinned && { pinnedAt: '2024-03-16T00:00:00.000Z' }),
    }),
  );

let io: ReturnType<typeof installIntersectionObserver>;

beforeEach(() => {
  io = installIntersectionObserver();
});

async function scrollToEnd() {
  io.trigger();
  await nextTick();
}

describe('ReadingList', () => {
  const mountList = (list = readings(0)) =>
    mount(ReadingList, { props: { readings: list, pet: makePet() }, global: global() });
  const shown = (wrapper: ReturnType<typeof mountList>) => wrapper.findAll('li').length;

  it('shows the empty text without readings', () => {
    const wrapper = mountList();
    expect(wrapper.get('.empty').text()).toContain('No readings yet');
    expect(wrapper.find('.sentinel').exists()).toBe(false);
  });

  it('shows 20 readings and the rest once the end is reached', async () => {
    const wrapper = mountList(readings(25));
    expect(shown(wrapper)).toBe(20);
    await scrollToEnd();
    expect(shown(wrapper)).toBe(25);
    expect(wrapper.find('.sentinel').exists()).toBe(false);
  });

  it('keeps paging when the first readings arrive after mounting', async () => {
    const wrapper = mountList([]);
    await wrapper.setProps({ readings: readings(45) });
    expect(shown(wrapper)).toBe(20);
    await scrollToEnd();
    expect(shown(wrapper)).toBe(40);
  });

  it('keeps paging after reaching the end and then growing', async () => {
    const wrapper = mountList(readings(25));
    await scrollToEnd();
    expect(shown(wrapper)).toBe(25);

    await wrapper.setProps({ readings: readings(50) });
    expect(shown(wrapper)).toBe(20);
    await scrollToEnd();
    expect(shown(wrapper)).toBe(40);
  });

  it('disconnects its observer on unmount', () => {
    const wrapper = mountList(readings(25));
    wrapper.unmount();
    expect(io.instances.every((o) => o.disconnected)).toBe(true);
  });
});

describe('NoteList', () => {
  const mountList = (list = notes(0)) =>
    mount(NoteList, { props: { notes: list, petId: 'pet-1' }, global: global() });
  const shown = (wrapper: ReturnType<typeof mountList>) => wrapper.findAll('li').length;

  it('shows the empty text without notes', () => {
    expect(mountList().get('.empty').text()).toContain('No notes yet');
  });

  it('shows section headers only when some notes are pinned', () => {
    expect(mountList(notes(3)).find('.section-header').exists()).toBe(false);
    const headers = mountList(notes(3, 1)).findAll('.section-header');
    expect(headers.map((h) => h.text())).toEqual(['Pinned', 'Notes']);
  });

  it('pages through notes and keeps paging after the list grows', async () => {
    const wrapper = mountList(notes(25));
    expect(shown(wrapper)).toBe(20);
    await scrollToEnd();
    expect(shown(wrapper)).toBe(25);

    await wrapper.setProps({ notes: notes(50) });
    await scrollToEnd();
    expect(shown(wrapper)).toBe(40);
  });

  it('keeps paging when the first notes arrive after mounting', async () => {
    const wrapper = mountList([]);
    await wrapper.setProps({ notes: notes(45) });
    await scrollToEnd();
    expect(shown(wrapper)).toBe(40);
  });

  it('disconnects its observer on unmount', () => {
    const wrapper = mountList(notes(25));
    wrapper.unmount();
    expect(io.instances.every((o) => o.disconnected)).toBe(true);
  });
});
