import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createController } from '../src/plugin/controller';
import { memoryStorage } from '../src/plugin/storage';
import type { MainToUi } from '../src/shared/messages';
import { auditConfig } from './fixtures';

// A small fake of the Figma globals the controller path touches. Real-node behaviour is covered
// by dev/e2e; this pins the message handler's contract.
const MIXED = Symbol('mixed');
const brandRaw = () => [{ type: 'SOLID', visible: true, color: { r: 0x63 / 255, g: 0x5b / 255, b: 0xff / 255 }, opacity: 1 }];

function makeFigma() {
  const listeners: (() => void)[] = [];
  const rect: Record<string, unknown> = {
    id: '9:2', type: 'RECTANGLE', name: 'Pay button', visible: true, removed: false,
    fills: brandRaw(), strokes: [], fillStyleId: '', strokeStyleId: '', resolvedVariableModes: {},
    cornerRadius: 8, width: 100, height: 40,
  };
  const page: Record<string, unknown> = {
    id: '9:1', type: 'PAGE', name: 'Test page', children: [rect], selection: [],
    on: (type: string, cb: () => void) => type === 'nodechange' && listeners.push(cb),
  };
  rect.parent = page;
  const brand = { id: 'V:brand', key: 'k', name: 'color/brand/primary', variableCollectionId: 'C:ds', remote: false, resolvedType: 'COLOR',
    valuesByMode: { m: { r: 0x63 / 255, g: 0x5b / 255, b: 0xff / 255, a: 1 } } };
  const collection = { id: 'C:ds', key: 'c', name: 'Tokens', remote: false, defaultModeId: 'm', variableIds: ['V:brand'] };
  const scrolled: unknown[] = [];
  const figma = {
    mixed: MIXED,
    skipInvisibleInstanceChildren: false,
    currentPage: page,
    viewport: { scrollAndZoomIntoView: (nodes: unknown[]) => scrolled.push(...nodes) },
    getNodeByIdAsync: async (id: string) => ({ '9:2': rect, '9:1': page } as Record<string, unknown>)[id] ?? null,
    setCurrentPageAsync: async (p: unknown) => void (figma.currentPage = p as typeof page),
    getLocalTextStylesAsync: async () => [],
    getLocalPaintStylesAsync: async () => [],
    getStyleByIdAsync: async () => null,
    variables: {
      getLocalVariableCollectionsAsync: async () => [collection],
      getLocalVariablesAsync: async () => [brand],
      getVariableByIdAsync: async (id: string) => (id === 'V:brand' ? brand : null),
      getVariableCollectionByIdAsync: async (id: string) => (id === 'C:ds' ? collection : null),
    },
  };
  return { figma, page, rect, scrolled, fireNodeChange: () => listeners.forEach((l) => l()) };
}

let env: ReturnType<typeof makeFigma>;
let sent: MainToUi[];
const ofType = <T extends MainToUi['type']>(t: T) => sent.filter((m): m is Extract<MainToUi, { type: T }> => m.type === t);

beforeEach(() => {
  env = makeFigma();
  (globalThis as unknown as { figma: unknown }).figma = env.figma;
  sent = [];
});
afterEach(() => vi.useRealTimers());

const setup = () => {
  const cfg = auditConfig({ variableCollections: [{ source: 'local', id: 'C:ds', name: 'Tokens' }] });
  return createController({ post: (m) => sent.push(m), storage: memoryStorage(cfg) });
};

describe('controller', () => {
  it('runs an audit from a UI message and stores a fingerprinted result', async () => {
    const c = setup();
    await c.handle({ type: 'init' });
    expect(ofType('init-state')[0].lastAudit).toBeNull();
    await c.handle({ type: 'run-audit', scope: 'page' });
    const [{ result }] = ofType('audit-result');
    expect(result.issues.map((i) => `${i.ruleId} ${i.nodeId}`)).toEqual(['color/raw-matches-token 9:2']);
    expect(result.rootIds).toEqual(['9:2']);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('reports a saved audit as current until an audited property changes', async () => {
    const c = setup();
    await c.handle({ type: 'init' });
    await c.handle({ type: 'run-audit', scope: 'page' });
    await c.handle({ type: 'check-freshness' });
    expect(ofType('audit-freshness').slice(-1)[0]?.state).toBe('current');

    env.rect.cornerRadius = 12; // still valid, but a different design
    await c.handle({ type: 'check-freshness' });
    expect(ofType('audit-freshness').slice(-1)[0]?.state).toBe('changed');
  });

  it('re-checks after edits on the page (debounced nodechange)', async () => {
    vi.useFakeTimers();
    const c = setup();
    await c.handle({ type: 'init' });
    await c.handle({ type: 'run-audit', scope: 'page' });
    env.rect.fills = [{ ...brandRaw()[0], boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'V:brand' } } }];
    env.fireNodeChange();
    env.fireNodeChange();
    await vi.advanceTimersByTimeAsync(1000);
    const states = ofType('audit-freshness').map((m) => m.state);
    expect(states).toEqual(['changed']); // two edits, one check
  });

  it('selects and scrolls to the node a go-to-node message names', async () => {
    const c = setup();
    await c.handle({ type: 'go-to-node', nodeId: '9:2' });
    expect(ofType('navigate-result')[0]).toMatchObject({ nodeId: '9:2', ok: true });
    expect((env.figma.currentPage.selection as unknown[])[0]).toBe(env.rect);
    expect(env.scrolled).toEqual([env.rect]);
  });

  it('says so instead of selecting something else when the node is gone', async () => {
    const c = setup();
    await c.handle({ type: 'go-to-node', nodeId: '404:1' });
    expect(ofType('navigate-result')[0]).toMatchObject({ ok: false, message: 'This layer no longer exists. Re-run the audit.' });
    expect(env.figma.currentPage.selection).toEqual([]);
  });
});

describe('design system persistence', () => {
  const localTokens = { source: 'local' as const, id: 'C:ds', name: 'Tokens' };
  const library = { source: 'library' as const, key: 'lib-key', name: 'Acme Colors' };

  it('keeps the saved design system across a plugin close and reopen', async () => {
    const device = { portable: null };
    const fileStorage = memoryStorage(null, device);
    const first = createController({ post: (m) => sent.push(m), storage: fileStorage });
    await first.handle({ type: 'init' });
    expect(ofType('init-state')[0].config.designSystem).toBeNull();

    const ds = { ...auditConfig().designSystem!, name: 'Acme', variableCollections: [localTokens, library] };
    await first.handle({ type: 'save-config', config: { ...auditConfig(), designSystem: ds, ignoredNodeIds: ['9:2'] } });
    expect(ofType('config-saved')[0].savedTo).toBe('file');

    sent = [];
    const reopened = createController({ post: (m) => sent.push(m), storage: fileStorage });
    await reopened.handle({ type: 'init' });
    const { config } = ofType('init-state')[0];
    expect(config.designSystem).toMatchObject({ name: 'Acme', variableCollections: [localTokens, library] });
    expect(config.ignoredNodeIds).toEqual(['9:2']);
  });

  it('offers another file only the portable (library) part, never file-specific ids', async () => {
    const device = { portable: null };
    const fileA = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, device) });
    const ds = { ...auditConfig().designSystem!, name: 'Acme', variableCollections: [localTokens, library] };
    await fileA.handle({ type: 'save-config', config: { ...auditConfig(), designSystem: ds, ignoredNodeIds: ['9:2'] } });

    sent = [];
    const fileB = createController({ post: (m) => sent.push(m), storage: memoryStorage(null, device) });
    await fileB.handle({ type: 'init' });
    const init = ofType('init-state')[0];
    expect(init.config.designSystem).toBeNull(); // file B has no settings of its own
    expect(init.config.ignoredNodeIds).toEqual([]);
    expect(init.portable?.variableCollections).toEqual([library]);
    expect(JSON.stringify(init.portable)).not.toContain('C:ds');
  });

  it('migrates a v1 config (consuming-file collection ids) to refs when loading', async () => {
    const v1 = { ...auditConfig(), designSystem: { name: 'Old', approvedCollectionIds: ['C:ds'], textStyles: { library: true, local: false },
      paintStyles: { library: false, local: false }, components: { library: true, local: false }, spacingScale: [0, 8], radiusScale: [0] } };
    const c = createController({ post: (m) => sent.push(m), storage: memoryStorage(v1 as never) });
    await c.handle({ type: 'init' });
    const ds = ofType('init-state')[0].config.designSystem!;
    expect(ds).toMatchObject({ version: 2, variableCollections: [{ source: 'local', id: 'C:ds', name: 'Tokens' }] });
    expect(ds.textStyles).toEqual({ library: true, local: false, items: [] });
  });
});
