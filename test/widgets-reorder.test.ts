import { describe, expect, it } from 'vitest';
import {
  assertCompletePermutation,
  assertSinglePosition,
  blockIdsOf,
  computeReorder,
  summarizeRendering,
} from '../src/kilango/widgets.js';

describe('computeReorder', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('moves by index', () => {
    expect(computeReorder(order, 'a', { index: 2 })).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves before another block', () => {
    expect(computeReorder(order, 'd', { before: 'b' })).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves after another block', () => {
    expect(computeReorder(order, 'a', { after: 'c' })).toEqual(['b', 'c', 'a', 'd']);
  });

  it('always yields a complete permutation', () => {
    const result = computeReorder(order, 'b', { index: 0 });
    expect([...result].sort()).toEqual([...order].sort());
  });

  it('throws for an unknown block or unknown anchor', () => {
    expect(() => computeReorder(order, 'z', { index: 0 })).toThrow(/not on this page/);
    expect(() => computeReorder(order, 'a', { before: 'z' })).toThrow(/unknown block/);
  });
});

describe('assertSinglePosition', () => {
  it('rejects more than one hint', () => {
    expect(() => assertSinglePosition({ index: 0, before: 'x' })).toThrow();
    expect(() => assertSinglePosition({ index: 0 })).not.toThrow();
    expect(() => assertSinglePosition(undefined)).not.toThrow();
  });
});

describe('assertCompletePermutation', () => {
  it('accepts a permutation and rejects add/drop', () => {
    expect(() => assertCompletePermutation(['a', 'b'], ['b', 'a'])).not.toThrow();
    expect(() => assertCompletePermutation(['a', 'b'], ['a'])).toThrow(/complete permutation/);
    expect(() => assertCompletePermutation(['a', 'b'], ['a', 'b', 'c'])).toThrow(/complete permutation/);
  });
});

describe('blockIdsOf', () => {
  it('reads blockId from top level or props', () => {
    expect(blockIdsOf([{ blockId: 'a' }, { props: { blockId: 'b' } }, { type: 'x' }])).toEqual(['a', 'b']);
  });
});

describe('summarizeRendering', () => {
  it('summarizes renderedIn/renderRole and is empty when absent', () => {
    expect(summarizeRendering({ renderedIn: 'facts-row' })).toContain('facts-row');
    expect(summarizeRendering({ nothing: true })).toBe('');
  });
});
