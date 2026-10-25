import { vi } from 'vitest';

/**
 * Installs a fake IntersectionObserver (undone by unstubGlobals after each test).
 * `trigger` reports every currently observed element as (not) intersecting, like
 * scrolling a list's sentinel into view.
 */
export function installIntersectionObserver() {
  const instances: FakeIntersectionObserver[] = [];

  class FakeIntersectionObserver {
    readonly observed = new Set<Element>();
    disconnected = false;

    constructor(private readonly callback: IntersectionObserverCallback) {
      instances.push(this);
    }

    observe(el: Element) {
      this.observed.add(el);
    }

    unobserve(el: Element) {
      this.observed.delete(el);
    }

    disconnect() {
      this.observed.clear();
      this.disconnected = true;
    }

    takeRecords() {
      return [];
    }
  }

  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

  return {
    instances,
    trigger(isIntersecting = true) {
      for (const observer of instances) {
        const entries = [...observer.observed].map(
          (target) => ({ target, isIntersecting }) as IntersectionObserverEntry,
        );
        if (entries.length > 0) {
          observer['callback'](entries, observer as unknown as IntersectionObserver);
        }
      }
    },
  };
}
