import { describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';
import { openTracker } from './openTracker';

const router = { push: vi.fn(async () => {}) } as unknown as Router;

describe('openTracker', () => {
  it('pushes the tracker for a pet id', () => {
    openTracker(router, 'pet-1');
    expect(router.push).toHaveBeenCalledExactlyOnceWith({
      name: 'tracker',
      params: { id: 'pet-1' },
    });
  });

  it('ignores an empty string, a number, null and undefined', () => {
    openTracker(router, '');
    openTracker(router, 42);
    openTracker(router, null);
    openTracker(router, undefined);
    expect(router.push).not.toHaveBeenCalled();
  });
});
