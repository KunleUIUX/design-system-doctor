import { beforeAll, describe, expect, it } from 'vitest';
import { countLayers, snapshotTree, AuditCancelled } from '../src/figma/snapshot';

// Minimal stand-ins for the Figma globals and nodes the reader touches.
const MIXED = Symbol('mixed');
beforeAll(() => {
  (globalThis as unknown as { figma: unknown }).figma = { mixed: MIXED };
});

type Fake = Record<string, unknown> & { id: string; type: string; children?: Fake[] };
let n = 0;
function fake(type: string, props: Partial<Fake> = {}): Fake {
  const node: Fake = {
    id: `1:${++n}`,
    type,
    name: `${type} ${n}`,
    visible: true,
    fills: [],
    strokes: [],
    fillStyleId: '',
    strokeStyleId: '',
    resolvedVariableModes: {},
    layoutMode: 'NONE',
    cornerRadius: 0,
    width: 100,
    height: 40,
    ...props,
  };
  for (const c of node.children ?? []) (c as Fake).parent = node;
  return node;
}

const opts = (onProgress = () => true) => ({ includeHidden: false, deadline: Date.now() + 10_000, onProgress });

describe('snapshotTree', () => {
  it('skips hidden layers and their contents, and counts them', async () => {
    const hiddenChild = fake('RECTANGLE');
    const root = fake('FRAME', { children: [fake('RECTANGLE'), fake('FRAME', { visible: false, children: [hiddenChild] })] });
    const r = await snapshotTree([root as unknown as SceneNode], opts());
    expect(r.nodes.map((s) => s.type)).toEqual(['FRAME', 'RECTANGLE']);
    expect(r.hiddenSkipped).toBe(1);
    expect(countLayers([root as unknown as SceneNode], false)).toBe(2);
  });

  it('records instance overrides on the instance and its sublayers', async () => {
    const label = fake('TEXT', {
      getStyledTextSegments: () => [
        { characters: 'Pay', start: 0, end: 3, textStyleId: '', fillStyleId: '', fills: [], fontName: { family: 'Inter', style: 'Medium' }, fontSize: 16, lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PIXELS', value: 0 } },
      ],
    });
    const untouched = fake('RECTANGLE');
    const instance = fake('INSTANCE', {
      children: [label, untouched],
      overrides: [{ id: label.id, overriddenFields: ['fontSize'] }],
      getMainComponentAsync: async () => ({ id: 'C:1', key: 'k', name: 'Button', remote: true, parent: null }),
    });
    instance.overrides = [{ id: label.id, overriddenFields: ['fontSize'] }];
    const r = await snapshotTree([instance as unknown as SceneNode], opts());
    const byId = Object.fromEntries(r.nodes.map((s) => [s.id, s]));
    expect(byId[instance.id].insideInstance).toBe(false);
    expect(byId[instance.id].instance?.main?.name).toBe('Button');
    expect(byId[label.id]).toMatchObject({ insideInstance: true, instanceOverrides: ['fontSize'] });
    expect(byId[untouched.id]).toMatchObject({ insideInstance: true, instanceOverrides: [] });
    expect(byId[label.id].path).toEqual([instance.name]);
  });

  it('counts unreadable layers as failed instead of aborting', async () => {
    const broken = fake('TEXT', { getStyledTextSegments: () => { throw new Error('boom'); } });
    const r = await snapshotTree([fake('FRAME', { children: [broken, fake('RECTANGLE')] }) as unknown as SceneNode], opts());
    expect(r.failed).toBe(1);
    expect(r.nodes).toHaveLength(2);
  });

  it('reads auto-layout spacing, skipping gaps that do nothing', async () => {
    const frame = fake('FRAME', {
      layoutMode: 'HORIZONTAL', itemSpacing: 18, paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8,
      primaryAxisAlignItems: 'MIN', layoutWrap: 'NO_WRAP', children: [fake('RECTANGLE')],
    });
    const r = await snapshotTree([frame as unknown as SceneNode], opts());
    expect(Object.keys(r.nodes[0].layout!.values)).toEqual(['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);
  });

  it('reads mixed corner radii per corner and detached info', async () => {
    const frame = fake('FRAME', {
      cornerRadius: MIXED, topLeftRadius: 8, topRightRadius: 8, bottomRightRadius: 0, bottomLeftRadius: 0,
      detachedInfo: { type: 'library', componentKey: 'btn' },
    });
    const [s] = (await snapshotTree([frame as unknown as SceneNode], opts())).nodes;
    expect(s.radius!.values).toEqual({ topLeftRadius: 8, topRightRadius: 8, bottomRightRadius: 0, bottomLeftRadius: 0 });
    expect(s.detached).toEqual({ type: 'library', componentKey: 'btn' });
  });

  it('reads each node’s children once, however wide the frame (Figma builds a new array per access)', async () => {
    const kids = Array.from({ length: 500 }, () => fake('RECTANGLE'));
    const root = fake('FRAME');
    let reads = 0;
    Object.defineProperty(root, 'children', { get: () => (reads++, [...kids]) });
    const r = await snapshotTree([root as unknown as SceneNode], opts());
    expect(r.nodes).toHaveLength(501);
    expect(reads).toBe(1);
  });

  it('can be cancelled', async () => {
    const root = fake('FRAME', { children: Array.from({ length: 600 }, () => fake('RECTANGLE')) });
    await expect(snapshotTree([root as unknown as SceneNode], opts(() => false))).rejects.toBeInstanceOf(AuditCancelled);
  });
});
