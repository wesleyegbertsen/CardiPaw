import { describe, expect, it } from 'vitest';
import { petInitial } from './petInitial';

describe('petInitial', () => {
  it('falls back to ? for a blank name', () => {
    expect(petInitial('')).toBe('?');
    expect(petInitial('  ')).toBe('?');
  });

  it('upper-cases the first letter', () => {
    expect(petInitial('mimi')).toBe('M');
    expect(petInitial('  bo')).toBe('B');
  });

  it('keeps a leading emoji whole', () => {
    expect(petInitial('🐱Mimi')).toBe('🐱');
  });
});
