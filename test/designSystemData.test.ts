import { beforeEach, describe, expect, it } from 'vitest';
import { loadDesignSystemData } from '../src/figma/designSystemData';
import type { NodeSnapshot } from '../src/shared/types';

// Remote (library) assets are resolved with one async API call each. These tests pin that cost:
// it must scale with the number of distinct assets referenced, never with the number of layers.
// Shapes mirror what Figma returned for a published library in the Phase 4 real-file check:
// key-based ids ("VariableID:<key>/1:4"), remote: true, collections listing only imported variables.

const BRAND = 'VariableID:f0cea0bc/1:4';
const COLORS = 'VariableCollectionId:5cf0ef50/1:0';
const BODY = 'S:89001002,1:26';
const ACME_COLORS = { source: 'library' as const, key: '5cf0ef50', name: 'Acme Colors' };

let calls: Record<string, number>;
beforeEach(() => {
  calls = { variable: 0, collection: 0, style: 0 };
  (globalThis as unknown as { figma: unknown }).figma = {
    mixed: Symbol('mixed'),
    getLocalTextStylesAsync: async () => [],
    getLocalPaintStylesAsync: async () => [],
    getStyleByIdAsync: async (id: string) => {
      calls.style++;
      return id === BODY
        ? { id, key: '89001002', name: 'Acme / Body', remote: true, type: 'TEXT', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16,
            lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PERCENT', value: 0 } }
        : null;
    },
    getNodeByIdAsync: async () => null,
    variables: {
      getLocalVariableCollectionsAsync: async () => [],
      getLocalVariablesAsync: async () => [],
      getVariableByIdAsync: async (id: string) => {
        calls.variable++;
        return id === BRAND
          ? { id, key: 'f0cea0bc', name: 'color/brand/primary', variableCollectionId: COLORS, remote: true, resolvedType: 'COLOR',
              valuesByMode: { '1:0': { r: 0.388, g: 0.357, b: 1, a: 1 } } }
          : null;
      },
      getVariableCollectionByIdAsync: async (id: string) => {
        calls.collection++;
        return id === COLORS ? { id, key: '5cf0ef50', name: 'Acme Colors', remote: true, defaultModeId: '1:0', variableIds: [BRAND] } : null;
      },
    },
  };
});

const layers = (n: number): NodeSnapshot[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `1:${i}`, name: 'Swatch', type: i % 2 ? 'RECTANGLE' : 'TEXT', path: [], insideInstance: false, variableModes: {},
    ...(i % 2
      ? { fills: [{ type: 'SOLID' as const, visible: true, color: { r: 0.388, g: 0.357, b: 1, a: 1 }, boundVariableId: BRAND }] }
      : { text: [{ start: 0, end: 1, characters: 'x', textStyleId: BODY, fills: [], fillStyleId: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
          lineHeight: { unit: 'PIXELS' as const, value: 24 }, letterSpacing: { unit: 'PERCENT' as const, value: 0 } }] }),
  }));

describe('loadDesignSystemData with library assets', () => {
  it('fetches each remote variable, collection and style once, however many layers use them', async () => {
    const data = await loadDesignSystemData(layers(2000), new Map(), [ACME_COLORS]);
    expect(calls).toEqual({ variable: 1, collection: 1, style: 1 });
    expect(data.variables).toEqual([expect.objectContaining({ id: BRAND, remote: true, collectionId: COLORS })]);
    expect(data.collections).toEqual([expect.objectContaining({ id: COLORS, remote: true })]);
    expect(data.textStyles).toEqual([expect.objectContaining({ id: BODY, name: 'Acme / Body', remote: true })]);
  });

  it('costs the same for 10 layers as for 2,000', async () => {
    await loadDesignSystemData(layers(10), new Map(), [ACME_COLORS]);
    const small = { ...calls };
    calls = { variable: 0, collection: 0, style: 0 };
    await loadDesignSystemData(layers(2000), new Map(), [ACME_COLORS]);
    expect(calls).toEqual(small);
  });
});
